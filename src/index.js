const fs = require('fs');
const config = require('./config');
const db = require('./database');
const { runCrawlCycle } = require('./crawler');
const kira = require('./kira');
const { sendSystemAlert } = require('./telegram');

let isRunning = true;
let sleepTimeout = null;

function sleep(ms) {
  return new Promise(resolve => {
    sleepTimeout = setTimeout(resolve, ms);
  });
}

async function shutdown(signal) {
  console.log(`\n[Process] Nhận tín hiệu ${signal}. Đang đóng hệ thống an toàn...`);
  isRunning = false;
  if (sleepTimeout) {
    clearTimeout(sleepTimeout);
  }

  try {
    db.close();
    console.log('[Database] Đã đóng kết nối SQLite an toàn.');
  } catch (err) {
    console.error('[Database Error khi đóng]:', err.message);
  }

  console.log('[System] Đã dừng toàn bộ tiến trình. Tạm biệt!');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function main() {
  console.log('================================================================');
  console.log('🏸 HỆ THỐNG TÌM KÈO GIAO LƯU CẦU LÔNG (120 Định Công / 488 Minh Khai / Tân Mai)');
  console.log('================================================================');
  console.log(`⏱️ Chu kỳ quét: ${config.crawler.baseIntervalSec}s + Jitter (${config.crawler.jitterMinSec}s - ${config.crawler.jitterMaxSec}s)`);
  console.log(`📍 Sân mục tiêu: 120 Định Công / Maxping, 488 Minh Khai, Tân Mai (Lọc khu vực: ${config.filterByTargetLocation ? 'Bật' : 'Tắt'})`);
  console.log(`📂 Danh sách nhóm theo dõi (${config.groups.length} nhóm):`);
  config.groups.forEach((g, idx) => {
    console.log(`   ${idx + 1}. [${g.id}] ${g.name}: ${g.url}`);
  });
  console.log(`💾 Cơ sở dữ liệu: ${config.paths.dbPath}`);
  console.log(`🤖 Telegram Bot: ${config.telegram.botToken ? 'Đã cấu hình' : 'Chưa cấu hình (chạy ở chế độ preview)'}`);
  console.log(`🧠 Kira AI: ${kira.isAvailable() ? `Đã kích hoạt (Model: ${config.kira.model}, BaseURL: ${config.kira.baseURL})` : 'Chưa cấu hình KIRA_API_KEY (Đang chạy chế độ Regex thuần)'}`);
  console.log(`🍪 Auth Cookie: ${fs.existsSync(config.paths.storageState) ? 'Đã sẵn sàng' : 'Chưa có file cookies/fb-auth.json'}`);
  console.log('================================================================\n');

  if (!kira.isAvailable()) {
    console.log('💡 [Gợi ý] Thêm KIRA_API_KEY vào .env để kích hoạt AI trích xuất thông tin chi tiết (giờ chơi, số lượng nam/nữ, trình độ, loại cầu...)');
    console.log('----------------------------------------------------------------\n');
  }

  if (!fs.existsSync(config.paths.storageState)) {
    console.warn('⚠️  LƯU Ý QUAN TRỌNG:');
    console.warn('Hệ thống chưa tìm thấy file cookies/fb-auth.json!');
    console.warn('Vui lòng làm theo hướng dẫn sau để đăng nhập:');
    console.warn('1. Chạy lệnh: npm run login');
    console.warn('HOẶC xuất cookie Facebook dạng JSON vào cookies/fb-auth.json');
    console.warn('----------------------------------------------------------------\n');
  } else {
    await sendSystemAlert(
      'Hệ thống khởi động',
      `Bot tìm kèo cầu lông (120 Định Công / 488 Minh Khai / Tân Mai) đã bắt đầu hoạt động trên ${config.groups.length} nhóm Facebook.`
    ).catch(() => {});
  }

  let cycleIndex = 1;

  while (isRunning) {
    console.log(`\n================== [CHU KỲ QUÉT #${cycleIndex}] ==================`);
    const startTime = Date.now();

    try {
      const result = await runCrawlCycle();

      if (!result.success && result.reason === 'checkpoint_detected') {
        console.error('⛔ Phát hiện Checkpoint hoặc phiên đăng nhập Facebook hết hạn!');
        console.error('Bot sẽ tạm nghỉ 15 phút trước khi thử lại hoặc chờ bạn cập nhật cookie mới...');
        await sleep(15 * 60 * 1000);
        continue;
      }
    } catch (cycleErr) {
      console.error('[Main Loop Error]:', cycleErr.message);
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    const dbStats = db.getStats();
    console.log(`📊 [Thống kê] Đã quét xong trong ${duration}s | Tổng lưu trữ: ${dbStats.total} items (${dbStats.posts} bài viết, ${dbStats.comments} bình luận)`);

    // Calculate dynamic jitter delay for anti-bot heuristics
    const jitterSec = Math.floor(
      Math.random() * (config.crawler.jitterMaxSec - config.crawler.jitterMinSec + 1)
    ) + config.crawler.jitterMinSec;
    const waitSec = config.crawler.baseIntervalSec + jitterSec;
    const nextCheckDate = new Date(Date.now() + waitSec * 1000);

    console.log(`💤 Nghỉ ${waitSec}s (${config.crawler.baseIntervalSec}s + ${jitterSec}s jitter)... Lượt quét tiếp theo lúc: ${nextCheckDate.toLocaleTimeString('vi-VN')}`);

    cycleIndex++;
    await sleep(waitSec * 1000);
  }
}

main().catch(err => {
  console.error('[Fatal Error]:', err);
  process.exit(1);
});
