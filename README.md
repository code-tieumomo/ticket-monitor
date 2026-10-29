# 🎫 Hệ Thống Giám Sát & Báo Động Vé Concert Facebook (fb-ticket-monitor)

Hệ thống tự động hóa quét bài viết và bình luận mới nhất trên các nhóm Facebook Public bằng Node.js + Playwright, phân tích lọc nhu cầu Pass/Nhượng vé bằng bộ lọc Regex thông minh, chống trùng lặp qua SQLite, và gửi thông báo tức thì về Telegram Bot kèm cảnh báo an toàn giao dịch.

---

## 🌟 Tính Năng Nổi Bật

- **Giám sát đa kênh:** Quét đồng thời các nhóm Facebook công khai theo thứ tự bài viết mới nhất (`sorting_setting=CHRONOLOGICAL`).
- **Phát hiện cả Bài viết & Bình luận (Posts & Comments):** Không bỏ sót các bình luận pass vé trong các bài đăng hot.
- **Trí tuệ Nhân tạo Kira AI (OpenAI-compatible):**
  - Tự động phân tích các bài đăng mà bộ lọc từ khóa Regex truyền thống bỏ sót (từ lóng, viết tắt, "ghép team", "thiếu 1 slot", teen code, văn phong tự nhiên).
  - Tự động trích xuất thông tin: Sân chơi, Ca/Giờ chơi, Số lượng slot, Trình độ (Y, TBY, TB, K...), Loại cầu, Chi phí, Liên hệ.
  - Tóm tắt nội dung bài đăng 1 câu ngắn gọn trực tiếp trên thông báo Telegram.
  - Hỗ trợ endpoint Kira AI (`https://kiraai.vn/api/v1`) với các model như `kira-2.5-flash`, `kira-3.5-pro`, `kira-3.5-flash`... xử lý gom lô (batch) tối ưu tốc độ và chi phí.
- **Bộ lọc thông minh kép (Hybrid Engine: Regex + Kira AI):**
  - Nhận diện nhu cầu bán: `pass`, `nhượng`, `bán lại`, `để lại`, `chia lại`, `pass gấp`...
  - Tự động loại trừ người tìm mua: `cần mua`, `tìm mua`, `tìm vé`, `thu mua`, `ai pass vé`...
  - Nhận diện hạng vé: VIP 1, VIP A, CAT 1-8, GA 1-5, Standing, Seated, Fanzone...
  - Nhận diện ngày diễn: Day 1, Day 2, Ngày 1, Ngày 2...
  - Nhận diện mức giá & hình thức giao dịch an toàn: "Dẫn vào sân", "GDTG" (giao dịch trung gian), "GDTT" (trực tiếp).
- **Chống khóa tài khoản (Anti-Checkpoint Heuristics):**
  - Tái sử dụng `storageState` session cookie, không đăng nhập lại nhiều lần.
  - Chu kỳ quét ngẫu nhiên có Jitter (90s + 10-40s random) tránh nhịp cố định của bot.
  - Tự động phát hiện Checkpoint/Captcha để tạm dừng và gửi cảnh báo về Telegram.
- **Deduplication:** Lưu hash và URL trong SQLite (hỗ trợ cả `node:sqlite` tích hợp và `better-sqlite3`), chống spam lặp lại thông báo.
- **Cảnh báo Lừa đảo (Scam Alert):** Luôn ghim khuyến cáo giao dịch trực tiếp mặt đối mặt, tuyệt đối không chuyển cọc trước.

---

## 📂 Cấu Trúc Dự Án

```text
camp-ticket/
├── cookies/
│   └── fb-auth.json         # Session cookie sau khi đăng nhập
├── db/
│   └── database.sqlite      # SQLite database lưu trữ ID và lịch sử đã quét
├── src/
│   ├── config.js            # Cấu hình Group URLs, Telegram Token, Gemini AI, Filter Rules
│   ├── database.js          # Module quản lý SQLite (tự động fallback giữa better-sqlite3 & node:sqlite)
│   ├── parser.js            # Engine phân tích Regex & phân loại từ khóa
│   ├── gemini.js            # Engine phân tích thông minh bằng Google Gemini 2.5 Flash Lite
│   ├── telegram.js          # Gửi tin nhắn Markdown/HTML qua Telegram API
│   ├── crawler.js           # Playwright scraper worker
│   ├── login-helper.js      # Công cụ đăng nhập & xuất session cookie
│   └── index.js             # Entrypoint & Scheduling loop với Jitter
├── tests/
│   ├── parser.test.js       # Test suite kiểm tra độ chính xác của bộ lọc Regex
│   ├── database.test.js     # Test suite kiểm tra database & deduplication
│   ├── telegram.test.js     # Test suite kiểm tra module Telegram
│   └── gemini.test.js       # Test suite kiểm tra module Gemini AI
├── .env.example             # Mẫu cấu hình biến môi trường
├── package.json
└── pm2.config.js            # File cấu hình chạy nền 24/7 với PM2
```

---

## 🚀 Hướng Dẫn Cài Đặt & Sử Dụng

### Bước 1: Cài đặt Dependencies

```bash
npm install
npx playwright install chromium
```

### Bước 2: Cấu hình Biến Môi Trường (`.env`)

Sao chép `.env.example` thành `.env` và điền thông tin:

```bash
cp .env.example .env
```

Chỉnh sửa các thông số:
```env
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ
TELEGRAM_CHAT_ID=-1001234567890

# Danh sách URL nhóm Facebook cần quét (phân cách bởi dấu phẩy)
FB_GROUP_URLS=https://www.facebook.com/groups/GROUP_ID_1,https://www.facebook.com/groups/GROUP_ID_2

# Cấu hình Kira AI Filter (OpenAI-compatible)
KIRA_BASE_URL=https://kiraai.vn/api/v1
KIRA_API_KEY=kira_...
KIRA_MODEL=kira-2.5-flash
ENABLE_KIRA=true
KIRA_MODE=smart
```

> **Cách lấy Telegram Bot Token & Chat ID:**
> 1. Chat với `@BotFather` trên Telegram để tạo bot và lấy `TELEGRAM_BOT_TOKEN`.
> 2. Thêm bot vào Group/Channel hoặc chat riêng với bot.
> 3. Lấy Chat ID qua bot `@userinfobot` hoặc gọi API `https://api.telegram.org/bot<TOKEN>/getUpdates`.

---

### Bước 3: Đăng Nhập Facebook & Tạo Cookie (`cookies/fb-auth.json`)

Bạn có thể dùng 1 trong 2 cách sau:

#### Cách 1: Đăng nhập tự động bằng giao diện (Desktop / WSL có GUI):
```bash
npm run login
```
Trình duyệt sẽ mở ra -> bạn chỉ cần đăng nhập tài khoản Facebook phụ -> hệ thống tự động lưu file `cookies/fb-auth.json`.

#### Cách 2: Xuất cookie từ trình duyệt bằng Extension (Khuyên dùng khi chạy trên VPS/WSL không có màn hình):
1. Mở trình duyệt Chrome/Edge trên máy tính cá nhân và đăng nhập Facebook.
2. Cài tiện ích [Cookie-Editor](https://cookie-editor.com/).
3. Bấm icon Cookie-Editor trên trang Facebook -> bấm nút **Export** -> chọn **Export as JSON**.
4. Dán nội dung JSON đó vào file `cookies/fb-cookies.json` trong thư mục dự án.
5. Chạy lệnh:
   ```bash
   npm run login
   ```
   Hệ thống sẽ tự động nhận diện và chuyển đổi sang định dạng `cookies/fb-auth.json` cho Playwright!

---

### Bước 4: Kiểm tra Hệ thống (Unit Tests)

Chạy bộ test để xác minh toàn bộ bộ lọc và database:

```bash
npm test
```

Kiểm tra thử gửi tin nhắn Telegram:
```bash
npm run test:telegram
```

---

### Bước 5: Khởi Động Bot

#### Chạy trực tiếp ở Terminal:
```bash
npm start
```

#### Chạy nền 24/7 với PM2:
```bash
# Cài đặt PM2 toàn cục (nếu chưa có)
npm install -g pm2

# Khởi chạy bot
pm2 start pm2.config.js

# Xem log hoạt động theo thời gian thực
pm2 logs fb-ticket-monitor

# Xem trạng thái
pm2 status

# Dừng bot
pm2 stop fb-ticket-monitor
```

---

## 🛡️ Lưu Ý Vận Hành & An Toàn Tài Khoản

1. **Sử dụng tài khoản Facebook phụ (Clone/Via):**
   - Tuyệt đối không dùng tài khoản chính chủ.
   - Nên dùng tài khoản đã tham gia sẵn các nhóm concert ít nhất vài ngày trước khi kích hoạt bot.
2. **Không giảm thời gian giãn cách quá ngắn:**
   - Mặc định là 90 giây + 10~40 giây ngẫu nhiên (jitter). Tần suất này mô phỏng người dùng lướt feed tự nhiên và an toàn.
3. **Cảnh báo Lừa đảo vé:**
   - Rất nhiều đối tượng lừa đảo hứa "dẫn vào sân" nhưng yêu cầu cọc trước 100k-500k qua tài khoản ngân hàng. Tuyệt đối không giao dịch chuyển khoản trước!
