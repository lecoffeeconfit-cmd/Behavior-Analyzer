export async function inspectFileMetadata(file: File): Promise<Record<string, string | number | boolean>> {
  const first = new Uint8Array(await file.slice(0, 2_000_000).arrayBuffer());
  const tail = file.size > 2_000_000 ? new Uint8Array(await file.slice(-2_000_000).arrayBuffer()) : new Uint8Array();
  const text = new TextDecoder("latin1").decode(first) + new TextDecoder("latin1").decode(tail);
  return { fileName: file.name, sizeBytes: file.size, mimeType: file.type || "Unknown", fileModifiedAt: new Date(file.lastModified).toISOString(), provenanceMarkerInSample: /c2pa|c2cl|jumb/i.test(text), provenanceVerification: "Not performed. Marker search only; presence or absence does not establish authenticity. File modification time is not recording time." };
}
