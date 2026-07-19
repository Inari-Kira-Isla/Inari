import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  cnToInt, coreReduce, sim, parseLine, matchLines, bestMatch, THRESHOLDS,
  type Candidate,
} from '../src/lib/order-engine';

// ── 純函式單元測 ────────────────────────────────────────────────
describe('cnToInt 中文數量', () => {
  it('阿拉伯數字', () => { expect(cnToInt('20')).toBe(20); });
  it('單字中文', () => { expect(cnToInt('三')).toBe(3); expect(cnToInt('兩')).toBe(2); });
  it('十位', () => { expect(cnToInt('十')).toBe(10); expect(cnToInt('三十')).toBe(30); expect(cnToInt('十五')).toBe(15); });
  it('對唔到→null', () => { expect(cnToInt('乜')).toBeNull(); });
});

describe('parseLine 抽 qty/uom/size/token', () => {
  it('簡體+單位', () => {
    const p = parseLine('无头甜虾肉 20包');
    expect(p.qty).toBe(20); expect(p.uom).toBe('包');
    expect(p.token).toContain('無頭甜蝦'); // 簡→繁
  });
  it('中文數量', () => {
    const p = parseLine('三文鱼两条95');
    expect(p.qty).toBe(2); expect(p.uom).toBe('條');
  });
  it('size 碼', () => {
    expect(parseLine('S北寄贝').size).toMatch(/S/);
    expect(parseLine('6g虎虾17').size).toBe('6g');
  });
  it('取消/更正 動作行→無 token', () => {
    expect(parseLine('取消三文魚').token).toBeNull();
    expect(parseLine('三文魚更正5條').token).toBeNull();
  });
  it('現金備註要剝走', () => {
    const p = parseLine('三文鱼2条(现金)');
    expect(p.token).toContain('三文魚'); expect(p.token).not.toContain('現金');
  });
  // ⚠ R1-KNOWN-ISSUE:裸三位數(通常係價錢)冇單位時被當數量。Py/TS 兩 port 一致行為。
  // 鎖住現況做迴歸,R1 優化(價錢 vs 數量啟發式)後再收緊此斷言。
  it('缺單位嘅裸數字→當前當 qty(R1待優化)', () => {
    expect(parseLine('三文鱼90').qty).toBe(90);
  });
});

describe('coreReduce 剝到核心品名', () => {
  it('剝括號+單位+產地噪音', () => {
    expect(coreReduce('急凍三文魚柳(500g)')).toBe('三文魚柳');
    expect(coreReduce('日本北海道赤貝肉')).toBe('赤貝肉');
  });
  it('唔剝「無」(免爛無頭甜蝦)', () => {
    expect(coreReduce('無頭甜蝦')).toContain('無頭');
  });
});

describe('sim 相似度閾值', () => {
  it('核心完全相等=1', () => { expect(sim('赤貝肉', '赤貝肉')).toBe(1); });
  it('含入=containment 分', () => { expect(sim('三文魚', '三文魚籽')).toBe(THRESHOLDS.containment); });
  it('無關→低分', () => { expect(sim('木魚花', '北寄貝')).toBeLessThan(THRESHOLDS.history); });
  it('單字唔觸發含入誤判', () => { expect(sim('魚', '三文魚')).toBeLessThan(1); });
});

describe('bestMatch 歷史頻率 tie-break', () => {
  it('平手用 n_times 拆(慣買者勝)', () => {
    const cands: Candidate[] = [
      { item_code: 'A', item_name: '赤貝肉', n_times: 5 },
      { item_code: 'B', item_name: '赤貝肉', n_times: 40 },
    ];
    const [best] = bestMatch('赤貝肉', cands, null);
    expect(best.item_code).toBe('B');
  });
});

describe('核心不變量:寧可 unmatched 都唔好高信心對錯貨', () => {
  it('歷史冇嘅口語錯字唔應該 history-match 落錯貨', () => {
    const hist: Candidate[] = [{ item_code: 'SAL', item_name: '三文魚柳', n_times: 20, last_uom: '條', last_price: 90 }];
    const glob: Candidate[] = [{ item_code: 'HIR', item_name: '希靈魚', revenue_3y: 30000, last_uom: '條', last_price: 55 }];
    const [item] = matchLines('黄希零3包', hist, glob);
    // 唔可以 history 高信心對到三文魚柳(完全唔關事)
    expect(item.match_confidence).not.toBe('history');
  });
});

// ── Gold set:confusion matrix scoreboard ───────────────────────
interface GoldLine { raw: string; expect_code: string | null; expect_conf: string; note?: string; }
interface GoldCust { name: string; hist: Candidate[]; lines: GoldLine[]; }
interface Gold { global: Candidate[]; customers: GoldCust[]; }

const gold: Gold = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/orders.golden.json', import.meta.url)), 'utf8')
);

describe('Gold set — 逐行 + scoreboard', () => {
  let total = 0, correct = 0, falseHigh = 0;
  let confMatch = 0, confTotal = 0; // 信心層對唔對
  const misses: string[] = [];

  for (const cust of gold.customers) {
    for (const gl of cust.lines) {
      it(`[${cust.name}] ${gl.raw}${gl.note ? ' — ' + gl.note : ''}`, () => {
        const [item] = matchLines(gl.raw, cust.hist, gold.global);
        total++; confTotal++;
        const gotCode = (item as any).product_code ?? null;
        const gotConf = item.match_confidence;
        const codeOk = gotCode === gl.expect_code;
        const confOk = gotConf === gl.expect_conf;
        if (codeOk) correct++;
        if (confOk) confMatch++;
        // false-high:引擎 history 高信心,但對錯貨(危險指標)
        if (gotConf === 'history' && !codeOk) { falseHigh++; misses.push(`⚠FALSE-HIGH [${cust.name}] "${gl.raw}" → ${gotCode}(期望${gl.expect_code})`); }
        else if (!codeOk) misses.push(`miss [${cust.name}] "${gl.raw}" → ${gotCode}/${gotConf}(期望${gl.expect_code}/${gl.expect_conf})`);
        // 逐行硬斷言:code 要對(baseline 會有 fail,正常;curate 後收斂)
        expect({ code: gotCode, conf: gotConf }).toEqual({ code: gl.expect_code, conf: gl.expect_conf });
      });
    }
  }

  // scoreboard(afterAll 印,唔算 assertion)
  it('__scoreboard__', () => {
    const pct = (n: number) => total ? Math.round((100 * n) / total) : 0;
    const board = [
      '',
      '═══════ 引擎 Gold Set Scoreboard ═══════',
      `  總行數        : ${total}`,
      `  品碼命中      : ${correct}/${total} = ${pct(correct)}%`,
      `  信心層命中    : ${confMatch}/${confTotal} = ${confTotal ? Math.round(100*confMatch/confTotal) : 0}%`,
      `  🔴 FALSE-HIGH : ${falseHigh}  (高信心對錯貨=硬閘,必須 0)`,
      `  thresholds    : history≥${THRESHOLDS.history} fuzzy≥${THRESHOLDS.fuzzy} containment=${THRESHOLDS.containment}`,
      '  ── 未命中明細 ──',
      ...misses.map(m => '  ' + m),
      '════════════════════════════════════════',
      '',
    ].join('\n');
    console.log(board);
    // 唯一硬閘:false-high 必須 0(寧可人手都唔可落錯單)
    expect(falseHigh, 'FALSE-HIGH 高信心對錯貨 = 落錯單風險,硬閘必須 0').toBe(0);
  });
});
