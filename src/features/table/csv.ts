/** Save `contents` as a file, as if downloaded */
export function downloadFile(contents: Blob, filename: string) {
  const url = URL.createObjectURL(contents);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Not at once: some browsers start the download after the click returns,
  // and would find the file gone
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
