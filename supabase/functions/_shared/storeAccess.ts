// Which store a seller function works on, and what the caller may do there.
//
// Sellers work on their own store. People a seller added on Team Access work
// on that seller's store by sending its id as store_id. Their role comes from
// public.buysell_store_role(), which honours an invite only for a Google
// sign-in with the invited address (email sign-ups are not confirmed here).

export type StoreRole = "owner" | "product_manager" | "store_manager" | "full_admin";
export type StoreAccess = { storeId: string; role: StoreRole; isOwner: boolean };

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

const TEAM_ROLES = new Set(["product_manager", "store_manager", "full_admin"]);

/** userClient must carry the caller's own token, so the role is worked out for them. */
export async function storeAccess(userClient: RpcClient, userId: string, requestedStore: unknown): Promise<StoreAccess> {
  const storeId = typeof requestedStore === "string" ? requestedStore.trim() : "";
  if (!storeId || storeId === userId) return { storeId: userId, role: "owner", isOwner: true };
  const { data, error } = await userClient.rpc("buysell_store_role", { p_store: storeId });
  if (error) throw new Error("Could not check your access to this store.");
  if (!TEAM_ROLES.has(String(data))) throw new Error("You do not have access to this store.");
  return { storeId, role: data as StoreRole, isOwner: false };
}

export function requireStoreRole(access: StoreAccess, allowed: StoreRole[], doing: string) {
  if (access.isOwner || allowed.includes(access.role)) return;
  throw new Error(`Your team role does not let you ${doing}.`);
}
