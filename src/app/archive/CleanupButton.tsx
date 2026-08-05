"use client";

import { useState } from "react";
import { doCleanup } from "./actions";

export default function CleanupButton({ totalItems }: { totalItems: number }) {
  const [cleaning, setCleaning] = useState(false);
  const [message, setMessage] = useState("");

  async function handleCleanup() {
    if (!confirm(`Вы уверены, что хотите НАВСЕГДА удалить ${totalItems} архивных записей? Это действие нельзя отменить.`)) return;
    
    setCleaning(true);
    setMessage("Удаление...");
    
    const res = await doCleanup();
    setMessage(res.message);
    setCleaning(false);
  }

  if (totalItems === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", alignItems: "flex-start" }}>
      <button 
        onClick={handleCleanup} 
        disabled={cleaning}
        className="pagination button" 
        style={{ background: "var(--error, #ef4444)", color: "white" }}
      >
        {cleaning ? "Очистка..." : "Очистить весь архив"}
      </button>
      {message && (
        <div style={{ padding: "8px 12px", background: "#e0f2fe", color: "#0369a1", borderRadius: "8px", fontSize: "0.9rem" }}>
          {message}
        </div>
      )}
    </div>
  );
}
