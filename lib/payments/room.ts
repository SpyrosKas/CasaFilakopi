import type { PaymentDeps } from "./deps";

export interface House {
  id: string;
  maxAdults: number;
  maxChildren: number;
}

/** Whole house only (D1): there is no room to choose. */
export async function loadHouse(deps: PaymentDeps): Promise<House | null> {
  let query = deps.db
    .from("rooms")
    .select("id, max_adults, max_children")
    .eq("is_active", true);
  if (deps.roomId) query = query.eq("id", deps.roomId);
  const { data, error } = await query
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (
    data && {
      id: data.id,
      maxAdults: data.max_adults,
      maxChildren: data.max_children,
    }
  );
}
