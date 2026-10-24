const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const config = require('./config');

const storagePath = config.paths.storageState;
const storageDir = path.dirname(storagePath);

/**
 * Checks if Facebook authentication cookies exist in a storageState object
 */
function hasFacebookAuthCookies(storageState) {
  if (!storageState || !Array.isArray(storageState.cookies)) return false;
  return storageState.cookies.some(c => c.name === 'c_user' || c.name === 'xs');
}

function normalizeSameSite(sameSite) {
  if (!sameSite) return 'Lax';
  const s = String(sameSite).toLowerCase().trim();
  if (s === 'no_restriction' || s === 'none') return 'None';
  if (s === 'strict') return 'Strict';
  return 'Lax';
}

/**
 * Converts standard JSON cookie arrays (from Cookie-Editor / EditThisCookie)
 * to Playwright storageState format if needed.
 */
function convertCookieArrayToStorageState(cookieList) {
  const playwrightCookies = cookieList.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain.startsWith('.') ? c.domain : `.${c.domain}`,
    path: c.path || '/',
    expires: c.expirationDate || Math.floor(Date.now() / 1000) + 31536000,
    httpOnly: Boolean(c.httpOnly),
    secure: Boolean(c.secure),
    sameSite: normalizeSameSite(c.sameSite)
  }));

  return {
    cookies: playwrightCookies,
    origins: []
  };
}

async function runLoginHelper() {
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }

  // Check if user already provided raw cookies file (e.g. cookies/cookies.json or cookies/fb-cookies.json)
  const alternativeCookiePaths = [
    path.join(storageDir, 'cookies.json'),
    path.join(storageDir, 'fb-cookies.json'),
  ];

  for (const altPath of alternativeCookiePaths) {
    if (fs.existsSync(altPath)) {
      console.log(`[Login Helper] Phát hiện file cookie thủ công tại: ${altPath}`);
      try {
        const raw = JSON.parse(fs.readFileSync(altPath, 'utf8'));
        let stateToSave = raw;
        if (Array.isArray(raw)) {
          console.log('[Login Helper] Đang chuyển đổi định dạng cookie extension sang Playwright storageState...');
          stateToSave = convertCookieArrayToStorageState(raw);
        }

        if (hasFacebookAuthCookies(stateToSave)) {
          fs.writeFileSync(storagePath, JSON.stringify(stateToSave, null, 2), 'utf8');
          console.log(`✅ Đã chuyển đổi và lưu phiên đăng nhập thành công vào: ${storagePath}`);
          return;
        } else {
          console.warn('[Login Helper] File cookie không chứa c_user/xs (chưa đăng nhập Facebook).');
        }
      } catch (err) {
        console.error('[Login Helper] Lỗi khi đọc file cookie thủ công:', err.message);
      }
    }
  }

  // Check display environment
  const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  if (!hasDisplay) {
    console.log('================================================================');
    console.log('⚠️  CẢNH BÁO MÔI TRƯỜNG KHÔNG CÓ GIAO DIỆN MÀN HÌNH (HEADLESS)');
    console.log('----------------------------------------------------------------');
    console.log('Hệ thống hiện tại không có biến $DISPLAY (thường gặp trên WSL hoặc VPS).');
    console.log('Bạn có thể đăng nhập bằng 1 trong 2 cách sau:');
    console.log('');
    console.log('👉 Cách 1 (Khuyên dùng - Nhanh nhất):');
    console.log('1. Cài extension "Cookie-Editor" trên Chrome/Edge trên máy của bạn.');
    console.log('2. Đăng nhập Facebook trên trình duyệt.');
    console.log('3. Bấm icon Cookie-Editor -> bấm "Export" -> "Export as JSON".');
    console.log(`4. Lưu nội dung vừa copy vào file: ${storagePath} hoặc cookies/fb-cookies.json`);
    console.log('');
    console.log('👉 Cách 2: Chạy lệnh với GUI / WSLg hoặc xvfb:');
    console.log('   xvfb-run npm run login');
    console.log('================================================================');
    return;
  }

  console.log('[Login Helper] Đang mở trình duyệt Chromium...');
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-notifications']
  });

  const context = await browser.newContext({
    viewport: config.crawler.viewport,
    userAgent: config.crawler.userAgent
  });

  const page = await context.newPage();

  console.log('================================================================');
  console.log('🌐 Vui lòng thao tác đăng nhập Facebook trên cửa sổ trình duyệt...');
  console.log('Hệ thống đang chờ bạn đăng nhập thành công...');
  console.log('Sau khi đăng nhập xong, bạn có thể nhấn phím ENTER tại terminal này.');
  console.log('================================================================');

  await page.goto('https://www.facebook.com');

  // Set up terminal keypress listener
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  let isSaved = false;

  const saveStorage = async () => {
    if (isSaved) return;
    isSaved = true;
    try {
      await context.storageState({ path: storagePath });
      console.log(`\n✅ Đã lưu phiên đăng nhập thành công vào: ${storagePath}`);
    } catch (err) {
      console.error('Lỗi khi lưu storageState:', err.message);
    } finally {
      rl.close();
      await browser.close();
    }
  };

  rl.question('\n👉 Nhấn ENTER sau khi đã đăng nhập Facebook thành công...', async () => {
    await saveStorage();
  });

  // Also auto-detect login by polling cookies
  const pollInterval = setInterval(async () => {
    try {
      const cookies = await context.cookies();
      const hasCUser = cookies.some(c => c.name === 'c_user');
      if (hasCUser) {
        clearInterval(pollInterval);
        console.log('\n🎉 Phát hiện đăng nhập Facebook thành công (tìm thấy cookie c_user)!');
        await saveStorage();
      }
    } catch {
      // Ignore if browser already closed
    }
  }, 3000);

  // Maximum wait 5 minutes
  setTimeout(async () => {
    if (!isSaved) {
      clearInterval(pollInterval);
      console.log('\n⏰ Đã hết thời gian chờ đăng nhập (5 phút). Đang lưu trạng thái hiện tại...');
      await saveStorage();
    }
  }, 300000);
}

if (require.main === module) {
  runLoginHelper().catch(err => {
    console.error('Fatal error in login-helper:', err);
    process.exit(1);
  });
}

module.exports = { runLoginHelper, convertCookieArrayToStorageState, hasFacebookAuthCookies };
