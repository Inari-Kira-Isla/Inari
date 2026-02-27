-- INARI Knowledge Base Schema

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at);

CREATE TABLE IF NOT EXISTS knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  question TEXT,
  answer TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 範例資料
INSERT INTO knowledge (category, question, answer) VALUES
('公司介紹', NULL, 'INARI 是一個提供專業服務的平台，致力於為客戶提供最優質的體驗。我們的團隊由經驗豐富的專業人士組成，為您提供全方位的支援。'),
('公司介紹', '你們是什麼公司？', 'INARI 是一家專注於科技與創新的企業，提供高品質的服務解決方案，幫助客戶實現業務目標。'),
('服務', NULL, 'INARI 提供多項專業服務，包括：顧問諮詢、系統整合、技術支援等，歡迎聯繫我們了解詳情。'),
('服務', '你們提供哪些服務？', 'INARI 的主要服務包括：\n1. 專業顧問諮詢\n2. 系統整合與建置\n3. 技術支援與維護\n4. 客製化解決方案\n\n請聯繫我們以獲取更多資訊。'),
('FAQ', '如何聯繫你們？', '您可以透過以下方式聯繫 INARI：\n- 電子郵件：contact@inari.example.com\n- 服務時間：週一至週五 09:00-18:00\n\n我們將盡快回覆您的詢問。'),
('FAQ', '費用如何計算？', '費用依據服務項目和需求而定，請聯繫我們的業務團隊進行評估，我們會提供詳細的報價。'),
('FAQ', '服務範圍在哪裡？', 'INARI 主要服務台灣地區的客戶，部分服務也可以遠端方式提供給全球客戶。'),
('聯繫方式', NULL, '聯繫 INARI：\n- Email: contact@inari.example.com\n- 服務時間：週一至週五 09:00-18:00\n- 我們承諾在一個工作天內回覆');
