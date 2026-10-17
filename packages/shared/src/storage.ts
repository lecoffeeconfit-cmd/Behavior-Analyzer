import type { VideoReport } from "./types";
const DB = "video-analyzer-local", STORE = "reports";
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Local history could not be opened. Your current report is still available for export."));
  });
}
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode), request = action(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(new Error("Local history could not be saved. Storage may be full; export this report and remove older reports.")); };
  });
}
export async function saveReport(report: VideoReport): Promise<void> { await transaction("readwrite", (store) => store.put(report)); }
export async function listReports(): Promise<VideoReport[]> {
  const rows = await transaction("readonly", (store) => store.getAll()) as VideoReport[];
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}
export async function deleteReport(id: string): Promise<void> { await transaction("readwrite", (store) => store.delete(id)); }
export async function clearReports(): Promise<void> { await transaction("readwrite", (store) => store.clear()); }
export function searchReports(rows: VideoReport[], term: string): VideoReport[] {
  const search = term.trim().toLowerCase();
  if (!search) return rows;
  return rows.filter((row) => [row.source.title, row.source.pageUrl, ...row.summary, ...row.transcript.map((s) => s.text), ...row.events.map((e) => e.label)].join(" ").toLowerCase().includes(search));
}
