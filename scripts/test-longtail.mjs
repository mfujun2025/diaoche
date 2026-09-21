// 纯逻辑测试：把 [[path]].ts 里的 parseSeg / parsePath / canonPath 摘出来跑
const TONNAGES = [8, 12, 16, 20, 25, 35, 50, 80, 100];
const PROVINCES = ['上海', '江苏', '浙江', '山东', '河南', '广东', '河北', '安徽'];
const BRANDS = ['徐工', '三一', '中联', '柳工'];

function parseSeg(raw) {
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,4})\s*(?:吨|t|T)?$/);
  if (m) {
    const n = Number(m[1]);
    if (TONNAGES.includes(n)) return { kind: 'tonnage', value: `${n}吨`, raw: String(n) };
    return null;
  }
  const prov = s.replace(/[省市]$/, '');
  if (PROVINCES.includes(prov)) return { kind: 'province', value: prov, raw: prov };
  if (BRANDS.includes(s)) return { kind: 'brand', value: s, raw: s };
  return null;
}
function parsePath(segs) {
  if (segs.length < 1 || segs.length > 3) return null;
  const q = {};
  const seen = new Set();
  for (const seg of segs) {
    const p = parseSeg(seg);
    if (!p) return null;
    if (seen.has(p.kind)) return null;
    seen.add(p.kind);
    if (p.kind === 'tonnage') q.tonnage = p.raw;
    else if (p.kind === 'province') q.province = p.raw;
    else q.brand = p.raw;
  }
  return Object.keys(q).length ? q : null;
}
function canonPath(q) {
  return [q.tonnage ? `${q.tonnage}吨` : '', q.province || '', q.brand || ''].filter(Boolean).join('/');
}

const cases = [
  [['2'], null, '纯数字走详情页分支，不该进 parsePath'],
  [['25'], { tonnage: '25' }, '裸数字吨位'],
  [['25吨'], { tonnage: '25' }, '带吨字'],
  [['25t'], { tonnage: '25' }, '英文 t'],
  [['25T'], { tonnage: '25' }, '大写 T'],
  [['江苏'], { province: '江苏' }, '省份'],
  [['江苏省'], { province: '江苏' }, '省份带省字'],
  [['上海'], { province: '上海' }, '直辖市'],
  [['上海市'], { province: '上海' }, '直辖市带市字'],
  [['徐工'], { brand: '徐工' }, '品牌'],
  [['25吨', '江苏'], { tonnage: '25', province: '江苏' }, '吨位+地区'],
  [['江苏', '25吨'], { tonnage: '25', province: '江苏' }, '乱序也认（canonical 会归一）'],
  [['25吨', '江苏', '徐工'], { tonnage: '25', province: '江苏', brand: '徐工' }, '三段'],
  [['9'], null, '9 吨不在白名单'],
  [['13吨'], null, '13 吨不在白名单'],
  [['abc'], null, '垃圾串'],
  [['25吨', '35吨'], null, '同维度重复'],
  [['25吨', '江苏', '徐工', '柳工'], null, '四段超限'],
  [['25吨', '江苏', '徐工', '柳工', '徐工'], null, '五段'],
];

let pass = 0;
let fail = 0;
/** 对象比较：只看键值，不看键顺序（parsePath 的键顺序取决于输入顺序，无意义） */
const same = (a, b) => {
  if (a === null || b === null) return a === b;
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.join(',') !== kb.join(',')) return false;
  return ka.every((k) => a[k] === b[k]);
};

console.log('parsePath:');
for (const [input, expect, note] of cases) {
  const got = parsePath(input);
  const ok = same(got, expect);
  if (ok) {
    pass++;
    console.log('  OK  ' + input.join('/') + '  ->  ' + JSON.stringify(got) + '   (' + note + ')');
  } else {
    fail++;
    console.log('  NG  ' + input.join('/') + '  ->  want ' + JSON.stringify(expect) + ' got ' + JSON.stringify(got) + '   (' + note + ')');
  }
}
console.log('\nparsePath: ' + pass + ' pass / ' + fail + ' fail');

console.log('\ncanonical normalize (order-independent):');
const a = canonPath(parsePath(['江苏', '25吨']));
const b = canonPath(parsePath(['25吨', '江苏']));
console.log('  /trucks/Jiangsu/25t/ vs /trucks/25t/Jiangsu/  ->  ' + a + ' / ' + b + '  ' + (a === b ? 'SAME' : 'DIFF'));

console.log('\nURL encoding (what browser actually sends):');
['25吨', '江苏', '徐工'].forEach((s) => {
  console.log('  ' + s + '  ->  ' + encodeURIComponent(s));
});
console.log('  full: /trucks/25吨/江苏/  ->  /trucks/' + ['25吨', '江苏'].map(encodeURIComponent).join('/') + '/');

console.log('\nsitemap combo segs sanity:');
[{ t: 25, p: null }, { t: null, p: '江苏' }, { t: 25, p: '江苏' }].forEach((c) => {
  const segs = [c.t ? c.t + '吨' : '', c.p || ''].filter(Boolean);
  console.log('  ' + JSON.stringify(c) + '  ->  /trucks/' + segs.map(encodeURIComponent).join('/') + '/');
});
