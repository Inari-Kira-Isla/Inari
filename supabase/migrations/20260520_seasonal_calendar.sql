-- T06: inari_seasonal_calendar
-- Public read-only table for monthly seafood seasonality

CREATE TABLE IF NOT EXISTS inari_seasonal_calendar (
  id            serial PRIMARY KEY,
  month         smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  item_name_zh  text NOT NULL,
  item_name_ja  text,
  item_name_en  text,
  origin        text,
  category      text NOT NULL DEFAULT 'seafood',  -- 'seafood' | 'premium'
  description_zh text,
  is_peak       boolean NOT NULL DEFAULT true,
  sort_order    smallint NOT NULL DEFAULT 0
);

ALTER TABLE inari_seasonal_calendar ENABLE ROW LEVEL SECURITY;
CREATE POLICY "seasonal_select_public" ON inari_seasonal_calendar FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS idx_seasonal_month ON inari_seasonal_calendar (month, sort_order);

INSERT INTO inari_seasonal_calendar
  (month, item_name_zh, item_name_ja, item_name_en, origin, category, description_zh, sort_order)
VALUES
  -- 1月
  (1, '毛蟹',   '毛ガニ',         'Hairy Crab',     '北海道',  'seafood',  '流冰前期蟹膏最飽滿',               1),
  (1, '真鯛',   'マダイ',         'Sea Bream',       '愛媛',    'seafood',  '正月寒鯛，市場最受追捧',           2),
  (1, '鮑魚',   'アワビ',         'Abalone',         '岩手',    'premium',  '冬季休眠後肉質緊實',               3),
  -- 2月
  (2, '牡蠣',   'カキ',           'Oyster',          '廣島',    'seafood',  '冬季肥美度達到頂峰，汁多味甜',     1),
  (2, '毛蟹',   '毛ガニ',         'Hairy Crab',      '北海道',  'seafood',  '2月蟹膏最豐厚',                    2),
  (2, '真鯛',   'マダイ',         'Sea Bream',       '瀬戶內海', 'seafood', '寒鯛脂質均衡，刺身絕佳',           3),
  -- 3月
  (3, '蛤蜊',   'ハマグリ',       'Clam',            '三重',    'seafood',  '女兒節傳統食材，鮮甜最佳',         1),
  (3, '帆立貝', 'ホタテ',         'Scallop',         '陸奥灣',  'seafood',  '春播種前捕撈，貝柱甜度高',         2),
  (3, '春鰹',   '初ガツオ',       'Bonito',          '土佐',    'seafood',  '春季初鰹，口感清爽低脂',           3),
  -- 4月
  (4, '春鰹',   '初ガツオ',       'Bonito',          '土佐',    'seafood',  '4月最鮮，脂質均衡，餐廳必備',      1),
  (4, '帆立貝', 'ホタテ',         'Scallop',         '陸奥灣',  'seafood',  '春撈貝柱飽滿，生食最佳',           2),
  (4, '鯛魚',   'マダイ',         'Sea Bream',        '瀬戶內海', 'seafood', '春鯛脂質上升，粉紅皮色最美',      3),
  -- 5月
  (5, '帆立貝', 'ホタテ',         'Scallop',         '北海道',  'seafood',  '初夏甜度最佳，刺身燒烤皆宜',       1),
  (5, '海膽',   'ムラサキウニ',   'Sea Urchin',      '青森',    'premium',  '春末夏初黏度高甜味豐',             2),
  (5, '毛蟹',   '毛ガニ',         'Hairy Crab',      '北海道',  'seafood',  '春季捕撈，蟹膏豐厚',               3),
  -- 6月
  (6, '馬糞海膽', 'バフンウニ',   'Uni (Bafun)',     '北海道',  'premium',  '夏季開漁，品質進入顛峰',           1),
  (6, '鰹魚',   'カツオ',         'Bonito',          '宮城',    'seafood',  '夏鰹脂質豐，赤身深厚',             2),
  (6, '岩牡蠣', 'イワガキ',       'Rock Oyster',     '山形',    'seafood',  '夏季岩牡蠣當令，肉大而豐',         3),
  -- 7月
  (7, '馬糞海膽', 'バフンウニ',   'Uni (Bafun)',     '利尻',    'premium',  '利尻夏季最高峰，甜度無可比擬',     1),
  (7, '鰻魚',   'ウナギ',         'Eel',             '愛知',    'seafood',  '土用丑日前後，餐廳需求最旺',       2),
  (7, '鮑魚',   'アワビ',         'Abalone',         '千葉',    'premium',  '夏季肉質最肥厚',                   3),
  -- 8月
  (8, '馬糞海膽', 'バフンウニ',   'Uni (Bafun)',     '北海道',  'premium',  '8月北海道全盛期，年度不可錯過',    1),
  (8, '秋刀魚', 'サンマ',         'Pacific Saury',   '北海道',  'seafood',  '初秋早市，脂質開始積累',           2),
  (8, '帆立貝', 'ホタテ',         'Scallop',         '陸奥灣',  'seafood',  '夏季第二撈，柱形壯實',             3),
  -- 9月
  (9, '秋刀魚', 'サンマ',         'Pacific Saury',   '根室',    'seafood',  '秋刀魚全盛期，脂質最豐',           1),
  (9, '戻り鰹', 'カツオ',         'Bonito (Autumn)', '三陸',    'seafood',  '秋鰹脂質是春季5倍，炙燒最佳',     2),
  (9, '松茸',   'マツタケ',       'Matsutake',       '京都',    'premium',  '解禁月，海鮮配松茸為高端套餐必備', 3),
  -- 10月
  (10, '毛蟹',  '毛ガニ',         'Hairy Crab',      '北海道',  'seafood',  '秋季最肥，蟹膏比春季更飽滿',       1),
  (10, '松葉蟹', 'ズワイガニ',    'Snow Crab',       '山陰',    'premium',  '11月解禁前最後熱身',               2),
  (10, '太刀魚', 'タチウオ',      'Cutlassfish',     '瀬戶內海', 'seafood', '秋季肥美，銀白光澤最靚麗',         3),
  -- 11月
  (11, '松葉蟹', 'ズワイガニ',    'Snow Crab',       '鳥取',    'premium',  '11月6日解禁，年度最矚目食材',      1),
  (11, '河豚',  'トラフグ',       'Tiger Blowfish',  '下關',    'premium',  '解禁月份，高端餐廳最搶手',         2),
  (11, '寒鰤',  'カンブリ',       'Winter Yellowtail', '能登',  'seafood',  '寒鰤季節開始，脂質快速累積',       3),
  -- 12月
  (12, '寒鰤',  'カンブリ',       'Yellowtail',      '富山',    'seafood',  '年末寒鰤脂質最豐，節慶餐廳首選',   1),
  (12, '河豚',  'トラフグ',       'Tiger Blowfish',  '下關',    'premium',  '聖誕除夕高端宴席必備',             2),
  (12, '牡蠣',  'カキ',           'Oyster',          '廣島',    'seafood',  '年末牡蠣再度飽滿，忘年會推薦',     3);
