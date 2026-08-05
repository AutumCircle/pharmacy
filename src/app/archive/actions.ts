"use server";

import { cleanupArchive } from "@/lib/api";
import { revalidatePath } from "next/cache";

export async function doCleanup() {
  try {
    const res = await cleanupArchive();
    revalidatePath("/archive");
    revalidatePath("/");
    return { success: true, message: res.message || "Архив успешно очищен!" };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}
