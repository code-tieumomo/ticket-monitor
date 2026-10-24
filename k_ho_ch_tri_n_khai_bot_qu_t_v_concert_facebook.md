# KẾ HOẠCH TRIỂN KHAI HỆ THỐNG GIÁM SÁT VÀ BÁO ĐỘNG VÉ CONCERT FACEBOOK GROUP

Tài liệu đặc tả giải pháp tự động hóa quét bài viết và bình luận (post/comment) trên 4 nhóm Facebook Public bằng Node.js + Playwright, tích hợp bộ lọc từ khóa/regex và đẩy thông báo tức thì qua Telegram Bot.

---

## 1. TỔNG QUAN HỆ THỐNG & NGHIỆP VỤ

### 1.1. Mục tiêu
* Tự động quét 4 nhóm Facebook công khai theo chu kỳ (polling cycle).
* Giám sát đồng thời nội dung **Bài viết mới (Posts)** và **Bình luận mới (Comments)** trong các bài viết gần nhất.
* Phân tích và lọc dữ liệu: Nhận diện nhu cầu bán (Pass/Nhượng), phân loại hạng vé (VIP, CAT, GA...), ngày diễn (Day 1, Day 2...), mức giá (nếu có), loại trừ các bài đăng "Cần mua/Tìm vé".
* Gửi cảnh báo tức thì về Telegram kèm link trực tiếp đến bài viết/bình luận.
* Chống trùng lặp thông báo (Deduplication) và chống khóa tài khoản Facebook (Anti-Checkpoint).

### 1.2. Luồng nghiệp vụ (Workflow)

```
[Cron / Worker Pool]
       │
       ▼
[Playwright Context (Đăng nhập qua Cookie/Storage State)]
       │
       ├──> Nhóm 1 (Sorted by: Chronological)
       ├──> Nhóm 2
       ├──> Nhóm 3
       └──> Nhóm 4
              │
              ▼ (Trích xuất Text, Author, ID, Link, Timestamp)
     [Engine Lọc & Phân Loại]
              │
              ├──> [Loại bỏ] (Bài tìm mua, spam, tin rác)
              └──> [Khớp bộ lọc] (Chứa hành động PASS + Hạng vé)
                        │
                        ▼
            [Kiểm tra Deduplication (SQLite)]
                        │
                        ├──> Đã gửi trước đó? ──> Bỏ qua
                        └──> Chưa gửi?
                                  │
                                  ▼
                    [Telegram Bot API Worker]
                                  │
                                  ▼
                    [Thông báo đến Channel/Group Admin]
```

---

## 2. KIẾN TRÚC KỸ THUẬT & STACK

* **Runtime:** Node.js (v18+ LTS).
* **Browser Automation:** `playwright` (Chromium engine) kết hợp kỹ thuật tái sử dụng `storageState` (cookie + session token).
* **Storage / Cache:** SQLite3 (dùng `better-sqlite3`) lưu danh sách các `post_id` / `comment_id` hoặc MD5 hash nội dung đã gửi, giúp bot nhẹ nhàng, không cần cài đặt database server phức tạp.
* **Notification:** `telegraf` hoặc gọi trực tiếp HTTP API của Telegram (`node-fetch` / `axios`).
* **Process Manager:** `pm2` để duy trì tiến trình chạy 24/7 trên VPS/Server hoặc máy local, tự động khởi động lại khi crash.

---

## 3. LOGIC XỬ LÝ & BỘ LỌC TỪ KHÓA (FILTER ENGINE)

### 3.1. Phân loại từ khóa

#### Nhóm 1: Hành động Cung (Intent: Bán/Nhượng)
* Từ khóa bắt buộc: `pass`, `nhượng`, `bán lại`, `để lại`, `nhượng lại`, `chia lại`, `pass lại`, `nhuong`, `de lai`.

#### Nhóm 2: Từ khóa Loại trừ (Negative Keywords - Tránh bài tìm mua)
* Nếu văn bản chứa các cụm sau ở vị trí ưu tiên thì **bỏ qua**:
  * `cần mua`, `tìm mua`, `cần pass không`, `tìm vé`, `cần tìm`, `mua vé`, `ai pass`, `thu mua`, `inbox giá mua`.

#### Nhóm 3: Thông tin phân hạng (Ticket Attributes)
* **Hạng vé:** `cat\s*[1-5]`, `vip`, `ga\s*[1-2]`, `svip`, `khu\s*[a-z]`, `standing`, `seated`.
* **Ngày diễn:** `day\s*[1-3]`, `d[1-3]`, `ngày\s*[1-3]`, `ngay\s*[1-3]`, `25\/10`, `26\/10` (tùy concert).
* **Hình thức bảo đảm (Tăng độ ưu tiên thông báo):** `dẫn vào sân`, `vào sân mới thanh toán`, `giao dịch trực tiếp`, `gdtg` (giao dịch trung gian), `check in xong mới trả`.

### 3.2. Cấu hình Regex chuẩn

```javascript
// Rule 1: Hành động bán
const SELL_ACTION_REGEX = /(pass|nhượng|nhuong|bán lại|ban lai|để lại|de lai|chia lại)/i;

// Rule 2: Từ khóa loại trừ
const NEGATIVE_REGEX = /(cần mua|can mua|tìm mua|tim mua|thu mua|cần tìm|tìm vé|tim ve|ai có.*pass)/i;

// Rule 3: Phân loại chi tiết
const TICKET_TIER_REGEX = /(vip|svip|cat\s*[1-8]|ga\s*[1-5]|khu\s*[a-z0-9]+)/i;
const DAY_REGEX = /(day\s*[1-4]|d[1-4]|ngày\s*[1-4])/i;
const ESCROW_HINT_REGEX = /(dẫn vào sân|dan vao san|vào sân mới|thanh toán sau|gdtg|trực tiếp|gdtt)/i;
```

---

## 4. THIẾT KẾ DỮ LIỆU (DATABASE SCHEMA - SQLITE)

Tạo file `database.sqlite` với cấu trúc bảng đơn giản để phục vụ deduplication:

```sql
CREATE TABLE IF NOT EXISTS processed_items (
    id TEXT PRIMARY KEY,           -- ID bài viết/comment hoặc MD5(text + author)
    group_id TEXT NOT NULL,        -- ID nhóm
    item_type TEXT NOT NULL,       -- 'POST' hoặc 'COMMENT'
    author_name TEXT,
    content TEXT,
    post_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_group ON processed_items (group_id);
```

---

## 5. MÃ NGUỒN TRIỂN KHAI CHI TIẾT (NODE.JS + PLAYWRIGHT)

### 5.1. Cấu trúc thư mục

```text
fb-ticket-monitor/
├── cookies/
│   └── fb-auth.json         # Session cookie sau khi đăng nhập
├── db/
│   └── database.sqlite
├── src/
│   ├── config.js            # Cấu hình Group URLs, Telegram Token, Filter Rules
│   ├── database.js          # SQLite wrapper
│   ├── parser.js            # Bóc tách nội dung và kiểm tra Regex
│   ├── telegram.js          # Gửi tin nhắn Markdown qua Telegram API
│   ├── crawler.js           # Playwright scraper worker
│   └── index.js             # Entrypoint & Scheduling loop
├── package.json
└── pm2.config.js
```

### 5.2. File cài đặt gói (`package.json`)

```json
{
  "name": "fb-ticket-monitor",
  "version": "1.0.0",
  "description": "Facebook Group Ticket Monitor using Playwright",
  "main": "src/index.js",
  "scripts": {
    "login": "node src/login-helper.js",
    "start": "node src/index.js"
  },
  "dependencies": {
    "better-sqlite3": "^11.8.1",
    "dotenv": "^16.4.7",
    "node-fetch": "^2.7.0",
    "playwright": "^1.50.0"
  }
}
```

### 5.3. Trình lưu phiên đăng nhập (`src/login-helper.js`)
Chạy file này 1 lần duy nhất ở giao diện có màn hình để đăng nhập Facebook và xuất `storageState`:

```javascript
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Vui lòng đăng nhập Facebook trên trình duyệt...');
  await page.goto('https://www.facebook.com');

  // Đợi đăng nhập thành công (khi xuất hiện thanh điều hướng chính)
  await page.waitForTimeout(60000); 

  await context.storageState({ path: 'cookies/fb-auth.json' });
  console.log('Đã lưu phiên đăng nhập vào cookies/fb-auth.json!');
  await browser.close();
})();
```

### 5.4. Trình quét bài viết và bình luận (`src/crawler.js`)

```javascript
const { chromium } = require('playwright');
const { parseContent } = require('./parser');
const db = require('./database');
const { sendAlert } = require('./telegram');

// Các URL group sắp xếp theo bài viết mới nhất
const GROUPS = [
  { id: 'group_1', url: 'https://www.facebook.com/groups/GROUP_ID_1?sorting_setting=CHRONOLOGICAL' },
  { id: 'group_2', url: 'https://www.facebook.com/groups/GROUP_ID_2?sorting_setting=CHRONOLOGICAL' },
  { id: 'group_3', url: 'https://www.facebook.com/groups/GROUP_ID_3?sorting_setting=CHRONOLOGICAL' },
  { id: 'group_4', url: 'https://www.facebook.com/groups/GROUP_ID_4?sorting_setting=CHRONOLOGICAL' },
];

async function runCrawlCycle() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-notifications']
  });

  const context = await browser.newContext({
    storageState: 'cookies/fb-auth.json',
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  for (const group of GROUPS) {
    try {
      console.log(`Đang kiểm tra: ${group.id}`);
      await page.goto(group.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      // Cuộn nhẹ để nạp khoảng 3-5 bài đăng mới nhất
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(2500);

      // Trích xuất các bài post thông qua container của Facebook (vai trò feed)
      const feedPosts = await page.$$eval('div[role="feed"] > div, div[role="article"]', elements => {
        return elements.slice(0, 5).map(el => {
          // Lấy toàn bộ text hiển thị trong bài viết
          const text = el.innerText || '';
          
          // Lấy link permalink của post (nếu có thẻ a trỏ vào post)
          const linkEl = el.querySelector('a[href*="/posts/"], a[href*="/permalink/"]');
          const postUrl = linkEl ? linkEl.href : null;
          
          return { text, postUrl };
        });
      });

      for (const item of feedPosts) {
        if (!item.text) continue;

        const analysis = parseContent(item.text);
        if (analysis.isMatch) {
          // Tạo mã ID định danh duy nhất (dùng URL hoặc fallback hash)
          const itemId = item.postUrl || Buffer.from(item.text.slice(0, 80)).toString('base64');

          if (!db.isExists(itemId)) {
            db.insertItem({
              id: itemId,
              group_id: group.id,
              item_type: 'POST',
              author_name: 'Unknown',
              content: item.text,
              post_url: item.postUrl || group.url
            });

            await sendAlert({
              groupName: group.id,
              type: 'POST',
              content: item.text,
              url: item.postUrl || group.url,
              tags: analysis.tags
            });
          }
        }
      }

      // Nghỉ ngẫu nhiên giữa các group để tránh bot detection
      const delay = Math.floor(Math.random() * (7000 - 4000 + 1) + 4000);
      await page.waitForTimeout(delay);

    } catch (err) {
      console.error(`Lỗi khi quét ${group.id}:`, err.message);
    }
  }

  await browser.close();
}

module.exports = { runCrawlCycle };
```

### 5.5. Trình gửi tin nhắn Telegram (`src/telegram.js`)

```javascript
const fetch = require('node-fetch');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendAlert({ groupName, type, content, url, tags }) {
  const shortContent = content.length > 500 ? content.slice(0, 497) + '...' : content;
  
  const message = [
    `🚨 *PHÁT HIỆN KÈO PASS VÉ MỚI!*`,
    `📌 *Kênh:* ${groupName} | *Loại:* ${type}`,
    `🏷 *Tag nhận diện:* ${tags.join(', ') || 'N/A'}`,
    `\n📝 *Nội dung:*`,
    `\`\`\`\n${shortContent}\n\`\`\``,
    `\n🔗 [ẤN VÀO ĐÂY ĐỂ MỞ BÀI VIẾT TRỰC TIẾP](${url})`
  ].join('\n');

  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: false
      })
    });
    const result = await res.json();
    if (!result.ok) {
      console.error('Lỗi gửi Telegram:', result.description);
    }
  } catch (err) {
    console.error('Lỗi kết nối Telegram API:', err.message);
  }
}

module.exports = { sendAlert };
```

---

## 6. CHIẾN LƯỢC PHÒNG TRÁNH CHECKPOINT (ANTI-DETECTION)

Facebook sở hữu hệ thống heuristic phân tích hành vi bot rất nghiêm ngặt. Để duy trì bot ổn định mà không bị khóa tài khoản:

1. **Chu kỳ quét (Polling Interval) có Jitter:**
   * Không đặt chu kỳ cố định (ví dụ chính xác 60s một lần).
   * Dùng khoảng giãn cách ngẫu nhiên: `Interval = 90s + Random(10s, 40s)`. Với 4 nhóm, mỗi nhóm sẽ được quét lại sau khoảng 1.5 - 2 phút.
2. **Sử dụng tài khoản phụ (Via / Clone có tương tác):**
   * Tuyệt đối không dùng tài khoản Facebook chính chủ.
   * Dùng tài khoản clone đã tạo trên 6 tháng, đã tham gia sẵn 4 nhóm đó ít nhất vài ngày, đã bật bảo mật 2 lớp (2FA).
3. **Quản lý Cookie & Trạng thái:**
   * Lưu `storageState` tái sử dụng, không thực hiện hành vi login/password liên tục.
   * Nếu Facebook bắt đầu hiển thị Captcha hoặc yêu cầu checkpoint, bắt exception trong code và gửi alert về Telegram: *"Cảnh báo: Tài khoản cần giải Captcha/Xác minh lại"*, sau đó tạm ngưng tiến trình (`process.exit(1)`).
4. **Giới hạn phạm vi DOM:**
   * Chỉ kiểm tra top 3–5 bài viết đầu trang mỗi lượt. Không scroll sâu quá 2 màn hình vì các bài viết cũ hơn đã được xử lý ở chu kỳ trước.

---

## 7. KẾ HOẠCH BẢO TRÌ & LƯU Ý GIAO DỊCH VÉ CONCERT

* **Bảo trì Selector:** Facebook thường xuyên thay đổi class CSS (obfuscated class names). Luôn sử dụng các thuộc tính ổn định như `role="feed"`, `role="article"`, thẻ `a[href*="/permalink/"]`, hoặc bóc tách trực tiếp toàn bộ khối `innerText`.
* **Cảnh báo Lừa đảo (Scam Alert):** Đa phần các bài viết cam kết "Dẫn vào sân mới thanh toán" trong các hội nhóm concert vẫn có tỉ lệ lừa đảo dưới hình thức: bắt cọc trước 100-200k tiền giữ vé, hoặc tráo vé giả tại cổng. Khi gửi thông báo về Telegram, nên ghim kèm ghi chú: *Chỉ giao dịch trực tiếp mặt đối mặt, không cọc trước dưới mọi hình thức.*