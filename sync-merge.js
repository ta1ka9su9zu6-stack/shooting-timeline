// sync-merge.js
// 複数人同時編集のためのフィールド単位 LWW(last-write-wins) マージ。
// DOM に依存しない純粋関数のみを提供する。app.js より前に読み込むこと。
//
// 設計の要点:
//  - 文書全体（state）を 1 つの状態として Supabase に保存しつつ、
//    受信時は「上書き」ではなく「マージ」する（state-based CRDT）。
//  - 各フィールド（セル・行・文書項目）に編集スタンプを持たせ、
//    新しい方の値を採用する。merge は冪等・単調なので、自分のエコーや
//    古い状態をマージしても情報が失われない（巻き戻らない）。
//  - スタンプ = { t: 論理時刻(number), c: clientId(string) }。
//    t が大きいほど新しく、t が同じときは c の辞書順で決定的に決める。
(function (global) {
  "use strict";

  // a が b より新しければ正、古ければ負、同等なら 0。
  function compareStamp(a, b) {
    const aOk = a && typeof a.t === "number";
    const bOk = b && typeof b.t === "number";
    if (!aOk && !bOk) return 0;
    if (!aOk) return -1;
    if (!bOk) return 1;
    if (a.t !== b.t) return a.t - b.t;
    const ac = a.c || "";
    const bc = b.c || "";
    if (ac < bc) return -1;
    if (ac > bc) return 1;
    return 0;
  }

  // 新しい方のスタンプを返す（両方未定義なら undefined）。
  function newerStamp(a, b) {
    return compareStamp(a, b) >= 0 ? a : b;
  }

  function emptyMeta() {
    return { doc: {}, rows: {} };
  }

  function stableJson(value) {
    return JSON.stringify(value === undefined ? null : value);
  }

  // row を { fieldKey: value } の平坦なマップにする。
  // base フィールドはキーそのまま、extras は "x:"+id、formats は "m:"+id。
  function flattenRow(row) {
    const flat = {};
    if (!row || typeof row !== "object") return flat;
    Object.keys(row).forEach((key) => {
      if (key === "id" || key === "extras" || key === "formats") return;
      flat[key] = row[key];
    });
    if (row.extras && typeof row.extras === "object") {
      Object.keys(row.extras).forEach((id) => {
        flat["x:" + id] = row.extras[id];
      });
    }
    if (row.formats && typeof row.formats === "object") {
      Object.keys(row.formats).forEach((id) => {
        flat["m:" + id] = row.formats[id];
      });
    }
    return flat;
  }

  function unflattenRow(id, flat) {
    const row = { id: id, extras: {}, formats: {} };
    Object.keys(flat).forEach((key) => {
      const value = flat[key];
      if (value === undefined) return;
      if (key.indexOf("x:") === 0) {
        row.extras[key.slice(2)] = value;
      } else if (key.indexOf("m:") === 0) {
        row.formats[key.slice(2)] = value;
      } else {
        row[key] = value;
      }
    });
    return row;
  }

  // state のうち rows と fieldMeta を除いた文書レベルのキー一覧。
  function docFieldKeys(state) {
    return Object.keys(state || {}).filter(
      (key) => key !== "rows" && key !== "fieldMeta"
    );
  }

  // prev と next の値を比較し、変更されたフィールドへ新しいスタンプを付ける。
  // next.fieldMeta を破壊的に更新する（ローカル編集の確定時に呼ぶ）。
  // makeStamp() は呼ぶたびに新しい stamp を返す関数。
  function stampChanges(prev, next, makeStamp) {
    if (!next.fieldMeta) next.fieldMeta = emptyMeta();
    const meta = next.fieldMeta;
    if (!meta.doc) meta.doc = {};
    if (!meta.rows) meta.rows = {};
    const prevState = prev || {};

    // 文書レベルのフィールド（columns 配列は丸ごと 1 つのレジスタとして扱う）
    const docKeys = new Set([
      ...docFieldKeys(prevState),
      ...docFieldKeys(next),
    ]);
    docKeys.forEach((key) => {
      if (stableJson(prevState[key]) !== stableJson(next[key])) {
        meta.doc[key] = makeStamp();
      }
    });

    const prevRows = Array.isArray(prevState.rows) ? prevState.rows : [];
    const nextRows = Array.isArray(next.rows) ? next.rows : [];
    const prevById = new Map(prevRows.map((row) => [row.id, row]));
    const nextById = new Map(nextRows.map((row) => [row.id, row]));

    nextRows.forEach((row) => {
      const id = row.id;
      let rowMeta = meta.rows[id];
      if (!rowMeta) {
        rowMeta = meta.rows[id] = { f: {} };
      }
      if (!rowMeta.f) rowMeta.f = {};
      const prevRow = prevById.get(id);
      if (!prevRow) {
        // 新規行: 作成スタンプと全フィールドにスタンプを付ける
        if (!rowMeta.c) rowMeta.c = makeStamp();
        rowMeta.d = null;
        const flat = flattenRow(row);
        Object.keys(flat).forEach((fk) => {
          rowMeta.f[fk] = makeStamp();
        });
        return;
      }
      const prevFlat = flattenRow(prevRow);
      const nextFlat = flattenRow(row);
      const keys = new Set([
        ...Object.keys(prevFlat),
        ...Object.keys(nextFlat),
      ]);
      keys.forEach((fk) => {
        if (stableJson(prevFlat[fk]) !== stableJson(nextFlat[fk])) {
          rowMeta.f[fk] = makeStamp();
        }
      });
    });

    // 削除された行は tombstone（削除スタンプ）を残す
    prevRows.forEach((row) => {
      if (nextById.has(row.id)) return;
      let rowMeta = meta.rows[row.id];
      if (!rowMeta) {
        rowMeta = meta.rows[row.id] = { f: {} };
      }
      rowMeta.d = makeStamp();
      if (!rowMeta.c) {
        const prevMetaRow =
          prevState.fieldMeta &&
          prevState.fieldMeta.rows &&
          prevState.fieldMeta.rows[row.id];
        rowMeta.c = (prevMetaRow && prevMetaRow.c) || makeStamp();
      }
    });

    return next;
  }

  // local と remote を LWW でマージした新しい state を返す（純粋関数）。
  // 値の部分のみ構築し、正規化(normalizeState)は呼び出し側で行う想定。
  function mergeStates(local, remote) {
    const lm = (local && local.fieldMeta) || emptyMeta();
    const rm = (remote && remote.fieldMeta) || emptyMeta();
    const lDoc = lm.doc || {};
    const rDoc = rm.doc || {};
    const lRowsMeta = lm.rows || {};
    const rRowsMeta = rm.rows || {};

    const result = {};
    const meta = emptyMeta();

    // 文書レベルのフィールド
    const docKeys = new Set([...docFieldKeys(local), ...docFieldKeys(remote)]);
    docKeys.forEach((key) => {
      const ls = lDoc[key];
      const rs = rDoc[key];
      const hasLocal = local && key in local;
      const hasRemote = remote && key in remote;
      const remoteWins = compareStamp(rs, ls) > 0;
      if (remoteWins && hasRemote) {
        result[key] = remote[key];
      } else if (hasLocal) {
        result[key] = local[key];
      } else if (hasRemote) {
        result[key] = remote[key];
      }
      const winnerStamp = newerStamp(ls, rs);
      if (winnerStamp) meta.doc[key] = winnerStamp;
    });

    // 行
    const localRows = Array.isArray(local && local.rows) ? local.rows : [];
    const remoteRows = Array.isArray(remote && remote.rows) ? remote.rows : [];
    const localById = new Map(localRows.map((row) => [row.id, row]));
    const remoteById = new Map(remoteRows.map((row) => [row.id, row]));
    const ids = new Set([
      ...localById.keys(),
      ...remoteById.keys(),
      ...Object.keys(lRowsMeta),
      ...Object.keys(rRowsMeta),
    ]);

    const mergedRows = [];
    ids.forEach((id) => {
      const lrm = lRowsMeta[id] || {};
      const rrm = rRowsMeta[id] || {};
      const created = newerStamp(lrm.c, rrm.c);
      const deleted = newerStamp(lrm.d, rrm.d);
      const rowMeta = { f: {} };
      if (created) rowMeta.c = created;
      rowMeta.d = deleted || null;

      const lr = localById.get(id);
      const rr = remoteById.get(id);
      const lFlat = flattenRow(lr);
      const rFlat = flattenRow(rr);
      const lf = lrm.f || {};
      const rf = rrm.f || {};
      const fieldKeys = new Set([
        ...Object.keys(lFlat),
        ...Object.keys(rFlat),
      ]);
      const mergedFlat = {};
      fieldKeys.forEach((fk) => {
        const hasL = fk in lFlat;
        const hasR = fk in rFlat;
        let chooseRemote;
        if (hasL && hasR) {
          chooseRemote = compareStamp(rf[fk], lf[fk]) > 0;
        } else {
          chooseRemote = hasR; // 片側だけにある場合はある方を採用
        }
        const value = chooseRemote ? rFlat[fk] : lFlat[fk];
        if (value !== undefined) {
          mergedFlat[fk] = value;
          const stamp = newerStamp(lf[fk], rf[fk]);
          if (stamp) rowMeta.f[fk] = stamp;
        }
      });

      meta.rows[id] = rowMeta;

      // 削除が作成より新しければ削除扱い（delete-wins）
      const isDeleted = deleted && compareStamp(deleted, created) > 0;
      const existsSomewhere = lr || rr;
      if (!isDeleted && existsSomewhere) {
        mergedRows.push({
          id: id,
          createdT: (created && created.t) || 0,
          row: unflattenRow(id, mergedFlat),
        });
      }
    });

    // 決定的な順序（作成時刻 → id）。表示時は開始時刻で並べ替えるため、
    // 配列順そのものはユーザーには見えない。
    mergedRows.sort((a, b) => {
      if (a.createdT !== b.createdT) return a.createdT - b.createdT;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    result.rows = mergedRows.map((entry) => entry.row);
    result.fieldMeta = meta;
    return result;
  }

  function canonStamp(s) {
    return s && typeof s.t === "number" ? { t: s.t, c: String(s.c || "") } : null;
  }

  // fieldMeta をキー順まで決定的なかたちに正規化する。
  // jsonb の往復でキー順が変わってもシリアライズ結果が安定する。
  function canonicalMeta(meta) {
    const src = meta && typeof meta === "object" ? meta : {};
    const out = { doc: {}, rows: {} };
    const doc = src.doc || {};
    Object.keys(doc)
      .sort()
      .forEach((key) => {
        const s = canonStamp(doc[key]);
        if (s) out.doc[key] = s;
      });
    const rows = src.rows || {};
    Object.keys(rows)
      .sort()
      .forEach((id) => {
        const rm = rows[id] || {};
        const c = canonStamp(rm.c);
        const d = canonStamp(rm.d);
        const f = rm.f || {};
        const outF = {};
        Object.keys(f)
          .sort()
          .forEach((fk) => {
            const s = canonStamp(f[fk]);
            if (s) outF[fk] = s;
          });
        // 空のエントリ（スタンプ無し）は残さない
        if (!c && !d && Object.keys(outF).length === 0) return;
        const outRow = {};
        if (c) outRow.c = c;
        outRow.d = d || null;
        outRow.f = outF;
        out.rows[id] = outRow;
      });
    return out;
  }

  // meta 内で観測した最大の論理時刻（受信側の論理クロックを進めるのに使う）。
  function maxStampT(meta) {
    let max = 0;
    if (!meta) return max;
    const scan = (stamp) => {
      if (stamp && typeof stamp.t === "number" && stamp.t > max) max = stamp.t;
    };
    Object.values(meta.doc || {}).forEach(scan);
    Object.values(meta.rows || {}).forEach((rowMeta) => {
      if (!rowMeta) return;
      scan(rowMeta.c);
      scan(rowMeta.d);
      Object.values(rowMeta.f || {}).forEach(scan);
    });
    return max;
  }

  global.SyncMerge = {
    compareStamp: compareStamp,
    newerStamp: newerStamp,
    emptyMeta: emptyMeta,
    flattenRow: flattenRow,
    unflattenRow: unflattenRow,
    stampChanges: stampChanges,
    mergeStates: mergeStates,
    canonicalMeta: canonicalMeta,
    maxStampT: maxStampT,
  };
})(typeof window !== "undefined" ? window : this);
