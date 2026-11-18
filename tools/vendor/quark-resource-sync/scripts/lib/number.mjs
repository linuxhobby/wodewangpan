/**
 * 编号分配器 —— 空洞优先（2026-11-04 改，为了解决死链问题）
 *
 * 旧口径：每个分类取「现有最大编号 +1」往后顺延。网盘目录被删掉之后，那个编号就永久空置，
 * 站点里指向它的条目成为死链，编号只增不减、空洞越积越多。
 *
 * 新口径：每轮先把该分类 001..max 的整条序列扫一遍，找出「夸克网盘上没有对应目录」的空编号，
 * 新资源**从最小空编号开始填**，空洞填完才继续 max+1 顺延。
 *
 * 判定权威 = 夸克实时目录列表（2026-11-04 用户定夺）。百度不做判定，永远跟随夸克本轮生成的 dirname。
 * 被回收的编号若站点仍留着同 id 旧条目（即那条死链本身），由调用方就地改写该条目，见 lib/yaml-store.mjs。
 */

/** 目录名 → 编号：`070-真相捕捉 1-2季` → 70；未编号返回 0 */
export const numOf = (name) => {
  const m = String(name).match(/^(\d+)\s*[-.]/);
  return m ? parseInt(m[1], 10) : 0;
};

/** 三位补零（全站口径：`001`，站点 id、网盘目录名都用它） */
export const pad3 = (n) => String(n).padStart(3, '0');

/** 从目录名列表提取已占用编号集合 */
export function usedSet(names) {
  const s = new Set();
  for (const n of names) {
    const v = numOf(n);
    if (v > 0) s.add(v);
  }
  return s;
}

/** 1..max 之间没有对应目录的空洞编号（升序） */
export function holesOf(used, max) {
  const holes = [];
  for (let n = 1; n <= max; n++) if (!used.has(n)) holes.push(n);
  return holes;
}

/**
 * 创建分配器。
 * @param {Set<number>} used  网盘上已占用的编号（夸克实时目录，唯一权威）
 * @param {number} max        网盘上现有最大编号
 * @param {{blocked?: Set<number>}} [opts]
 *   blocked：网盘上虽然没目录、但**站点别的分类文件里已经占用了这个 id** 的编号（例如
 *   documentary.yaml 里那条 id 写成 `mv-046` 的历史异常）。这类编号跳过不用，避免全站 id 撞号。
 * @returns {{next:()=>number, release:(n:number)=>void, holes:number[], max:number, assigned:number[]}}
 */
export function createAllocator(used, max, opts = {}) {
  const blocked = opts.blocked || new Set();
  const taken = new Set();
  const free = (n) => !used.has(n) && !blocked.has(n) && !taken.has(n);

  return {
    max,
    used: [...used].sort((a, b) => a - b),
    blocked: [...blocked].sort((a, b) => a - b),
    holes: holesOf(new Set([...used, ...blocked]), max),
    /** 取本轮下一个可用编号：全局最小的空闲编号 —— 先填网盘空洞，空洞用完才往后顺延 */
    next() {
      const limit = max + taken.size + 2; // 上界：所有已分配都落到 max 之后时也能扫到
      for (let n = 1; n <= limit; n++) if (free(n)) { taken.add(n); return n; }
      throw new Error(`编号分配失败：1..${limit} 全部被占用`);
    },
    /** 建目录/入库失败时把编号还回池子，下一轮 next() 会重新取到它，不跳号 */
    release(n) { taken.delete(n); },
    get assigned() { return [...taken].sort((a, b) => a - b); },
  };
}

/**
 * 把网盘空洞分成三类，供调用方决定怎么用。
 *
 * @param {Set<number>} used       夸克该分类已占用编号（唯一权威）
 * @param {number} max             夸克该分类现有最大编号
 * @param {{prefix:string, file:string, occupancy:Map<string,string>}} opts
 *   prefix：该分类 id 前缀（mv/tv/dc/an/game/app/bk/ot/os/cs）
 *   file ：该分类对应的站点数据文件（movie.yaml …）
 *   occupancy：全站 data/*.yaml 的 id → 文件名映射，见 lib/yaml-store.mjs 的 idOccupancy()
 * @returns {{free:number[], reclaim:number[], blocked:number[]}}
 *   free    ：网盘没目录、站点也没条目 → 直接补位，追加新条目
 *   reclaim ：网盘没目录、但**本分类**站点文件里还留着同 id 旧条目 → 补位 + 就地改写（那条旧条目就是死链）
 *   blocked ：网盘没目录，但这个 id 被**别的分类文件**占着（如 documentary.yaml 里写成 mv-046 的历史异常）
 *             → 不要用，用了会全站 id 撞号；分配器会跳过它
 */
export function classifyHoles(used, max, opts) {
  const { prefix, file, occupancy } = opts;
  const free = [], reclaim = [], blocked = [];
  for (const n of holesOf(used, max)) {
    const where = occupancy.get(`${prefix}-${pad3(n)}`);
    if (!where) free.push(n);
    else if (where === file) reclaim.push(n);
    else blocked.push(n);
  }
  return { free, reclaim, blocked };
}
