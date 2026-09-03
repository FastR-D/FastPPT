import { useEffect, useMemo, useState } from "react";
import "./CommandPalette.css";

export type StudioCommand = { id: string; label: string; shortcut?: string; run: () => void };

export function CommandPalette({ commands }: { commands: StudioCommand[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => commands.filter((command) => command.label.toLowerCase().includes(query.trim().toLowerCase())), [commands, query]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen((value) => !value); }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  if (!open) return null;
  const execute = (command?: StudioCommand) => { if (!command) return; setOpen(false); setQuery(""); command.run(); };
  return <div className="command-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
    <section className="command-palette" role="dialog" aria-modal="true" aria-label="命令面板">
      <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") execute(filtered[0]); }} placeholder="输入命令…"/>
      <div>{filtered.map((command) => <button key={command.id} onClick={() => execute(command)}><span>{command.label}</span>{command.shortcut && <kbd>{command.shortcut}</kbd>}</button>)}{!filtered.length && <p>没有匹配的命令</p>}</div>
    </section>
  </div>;
}
