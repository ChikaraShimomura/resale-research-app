// チーム完全共有：データの「名前空間（actor）」を解決する単一ソース。
// チームに属している間は、本人の普通の画面（商品管理/マイページ/カタログ/お気に入り）が
// チームの共有データ＝オーナーの名前空間を読み書きする。これで全員が同じプールを見る。
//
//  getDataActor : 共有データ（お気に入り/仕入れ商品/送料/非表示/出品deal/収益）の名前空間。
//                 チーム参加中＝オーナー、ソロ/オーナー本人＝自分。
//  getEbayActor : eBay連携トークン/SKU対応表/eBay API の対象アカウント。
//                 共有モード＝オーナー、個別モード＝本人（各自のeBayで出品するため）。
//  ※ 認証・課金・出品権限の判定は従来どおり「本人(getActorId)」で行う（共有とは別軸）。
import { cache } from "react";
import { getActorId } from "./actor";
import { getMyTeams, getTeamMode } from "../team";

export interface TeamContext {
  viewer: string | null; // ログイン本人
  dataActor: string | null; // 共有データの名前空間（チーム時=オーナー）
  ebayActor: string | null; // eBayアカウントの名前空間（共有=オーナー/個別=本人）
  owner: string | null; // 所属チームのオーナー（非所属=null）
  isMember: boolean; // 他人のチームに参加しているメンバーか
  mode: "shared" | "individual" | null;
}

// 本人が参加しているチーム（メンバーとして）を引いて、共有名前空間を決める。
// オーナー本人は getMyTeams に出ない（自分のチームには「参加」しない）ので dataActor=自分＝チームの共有先と一致。
// ★request-scoped memo(2026-07-11)：1リクエストで複数回呼ばれても team解決(KV+actor往復)は1回だけ（React cache・非破壊）。
export const getTeamContext = cache(async (): Promise<TeamContext> => {
  const viewer = (await getActorId()) ?? null;
  if (!viewer) return { viewer, dataActor: null, ebayActor: null, owner: null, isMember: false, mode: null };
  let teams: { ownerActor: string }[] = [];
  try {
    teams = await getMyTeams(viewer);
  } catch {
    /* noop */
  }
  if (teams.length) {
    const owner = teams[0].ownerActor; // 当面は1チーム想定（複数参加は先頭）
    let mode: "shared" | "individual" = "individual";
    try {
      mode = await getTeamMode(owner);
    } catch {
      /* noop */
    }
    return { viewer, dataActor: owner, ebayActor: mode === "shared" ? owner : viewer, owner, isMember: true, mode };
  }
  return { viewer, dataActor: viewer, ebayActor: viewer, owner: null, isMember: false, mode: null };
});

// 共有データの名前空間（在庫/お気に入り/送料/非表示/deal/収益）。
export async function getDataActor(): Promise<string | null> {
  return (await getTeamContext()).dataActor;
}

// eBayアカウントの名前空間（トークン/SKU対応表/eBay API）。
export async function getEbayActor(): Promise<string | null> {
  return (await getTeamContext()).ebayActor;
}
