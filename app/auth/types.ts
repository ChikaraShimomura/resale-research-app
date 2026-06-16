// 認証フォーム(useActionState)の戻り値。"use server" ファイルからは関数しか export できないため別ファイルに分離。
export interface AuthState {
  error?: string;
  message?: string;
}
