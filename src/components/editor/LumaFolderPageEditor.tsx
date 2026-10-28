'use client';

import { useState, type ReactNode } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ArrowDown, ArrowUp, Check, Copy, FolderOpen, Layers, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer';
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import { useMobile } from '@/hooks/use-mobile';
import { folderToItem, itemToDraftFolder, cloneFolder } from '@/lib/luma-editor-adapter';
import { newID, MAX_DEPTH, type Folder, type Section } from '@/lib/luma-document';
import type { CollectionItem } from '@/lib/types/widget';
import { cn } from '@/lib/utils';
import { CollectionItemEditor } from './CollectionItemEditor';
import { AddItemDialog } from './AddItemDialog';
import { editorActionButtonClass, editorFooterPrimaryButtonClass, editorFormSurfaceClass, editorPanelClass } from './editorSurfaceStyles';

const smallAction = 'h-9 rounded-xl border border-border/60 bg-background/70 px-3 text-[10px] font-bold uppercase tracking-wider';
function ShapePicker({ value, onChange, label }: { value: string; label: string; onChange: (shape: string) => void }) {
  return <label className="flex items-center gap-3 text-xs font-semibold text-muted-foreground">{label}<select aria-label={label} value={value} onChange={e => onChange(e.target.value)} className="h-9 min-w-0 rounded-xl border border-border/60 bg-background px-3 text-xs"><option value="LANDSCAPE">Wide</option><option value="POSTER">Poster</option><option value="SQUARE">Square</option></select></label>;
}
function FolderList({ folders, depth, onChange }: { folders: Folder[]; depth: number; onChange: (folders: Folder[]) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ folder: Folder; index: number } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  function drag(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const next = [...folders], from = next.findIndex(f => f.id === event.active.id), to = next.findIndex(f => f.id === event.over!.id);
    if (from < 0 || to < 0) return; const [folder] = next.splice(from, 1); next.splice(to, 0, folder); onChange(next);
  }
  return <div className="space-y-3">
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={drag}><SortableContext items={folders.map(f => f.id)} strategy={verticalListSortingStrategy}>
      {folders.map((folder, i) => <div key={folder.id} className="space-y-1"><CollectionItemEditor item={folderToItem(folder)} index={i} depth={depth} isExpanded={expanded === folder.id} onToggleExpand={() => setExpanded(expanded === folder.id ? null : folder.id)} onUpdate={updates => onChange(folders.map((f, index) => index === i ? itemToDraftFolder({ ...folderToItem(f), ...updates }) : f))} onDelete={() => { setRemoved({ folder, index: i }); onChange(folders.filter((_, index) => index !== i)); }} />
        <div className="flex justify-end"><Button variant="ghost" size="sm" className="h-7 text-[10px] text-muted-foreground" onClick={() => { const next = [...folders]; const copy = cloneFolder(folder); copy.title += ' (copy)'; next.splice(i + 1, 0, copy); onChange(next); }}><Copy className="mr-1.5 size-3" />Duplicate folder</Button></div></div>)}
    </SortableContext></DndContext>
    {!folders.length && <div className="rounded-2xl border border-dashed border-border/70 bg-muted/10 p-6 text-center"><FolderOpen className="mx-auto mb-2 size-6 text-primary/40" /><p className="text-xs text-muted-foreground">Add a folder to build this part of your hub.</p></div>}
    <div className="flex flex-wrap gap-2"><AddItemDialog onAdd={item => { onChange([...folders, itemToDraftFolder(item)]); setExpanded(item.id); }} trigger={<Button variant="ghost" className={cn(smallAction, 'border-primary/20 bg-primary/5 text-primary')}><Plus className="mr-2 size-3.5" />Add folder</Button>} />
      {removed && <Button variant="ghost" className={smallAction} onClick={() => { const next = [...folders]; next.splice(Math.min(removed.index, next.length), 0, removed.folder); onChange(next); setRemoved(null); }}><RotateCcw className="mr-2 size-3.5" />Restore {removed.folder.title}</Button>}</div>
  </div>;
}
export function LumaFolderPageEditor({ item, onUpdate, depth }: { item: CollectionItem; depth: number; onUpdate: (updates: Partial<CollectionItem>) => void }) {
  const mobile = useMobile();
  const [open, setOpen] = useState(false);
  const [sectionName, setSectionName] = useState('');
  const [addingSection, setAddingSection] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Section | null>(null);
  const [removedSection, setRemovedSection] = useState<{ section: Section; index: number } | null>(null);
  const [undo, setUndo] = useState<Folder[]>([]);
  const folder = itemToDraftFolder(item);
  const sections = folder.sections ?? [];
  const canNest = depth < MAX_DEPTH;
  function update(next: Folder) { setUndo(previous => [...previous.slice(-19), folder]); onUpdate({ lumaFolder: next }); }
  const catalogBlocks = (folder.sources ?? []).map((s, i) => ({ id: `catalog:${s.id ?? `source-${i}`}`, label: String(s.title || s.catalogId || `Catalog ${i + 1}`) }));
  const blocks = [...catalogBlocks, ...sections.map(s => ({ id: `section:${s.id}`, label: s.title }))];
  const order = [...new Set([...(folder.blockOrder ?? []).filter(k => blocks.some(b => b.id === k)), ...blocks.map(b => b.id)])];
  function moveBlock(index: number, offset: number) { const next = [...order]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; update({ ...folder, blockOrder: next }); }
  function sectionChange(index: number, changes: Partial<Section>) { update({ ...folder, sections: sections.map((s, i) => i === index ? { ...s, ...changes } : s) }); }
  function labeledInput(label: string, value: unknown, change: (value: string) => void) { return <label className="block space-y-2"><span className="text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground">{label}</span><Input value={String(value ?? '')} onChange={e => change(e.target.value)} className="rounded-xl bg-background/70" /></label>; }
  const content: ReactNode = <div className="flex min-h-0 flex-1 flex-col">
    <header className="shrink-0 border-b border-border/40 px-6 py-5 pr-16 sm:px-8 sm:pr-20"><div className="mb-3 flex items-center justify-between gap-4"><span className="text-[10px] font-black uppercase tracking-[.18em] text-primary">Luma · Folder level {depth} of {MAX_DEPTH}</span><Button variant="ghost" className={smallAction} disabled={!undo.length} onClick={() => { const previous = undo.at(-1); if (previous) { onUpdate({ lumaFolder: previous }); setUndo(undo.slice(0, -1)); } }}><RotateCcw className="mr-2 size-3.5" />Undo</Button></div><h2 className="text-2xl font-black tracking-tight">{item.name}</h2><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Add horizontal sections and a grid of subfolders to make this folder a hub. Catalogs are edited in the folder card.</p></header>
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-6 sm:px-8 custom-scrollbar">
      <section className={cn(editorPanelClass, 'space-y-4 bg-background/60 p-5')}><div className="flex items-center gap-2"><Layers className="size-4 text-primary" /><h3 className="text-sm font-bold">Page order</h3></div><p className="text-xs text-muted-foreground">Arrange catalog rows and sections. The subfolder grid always appears last.</p>{order.map((id, i) => <div key={id} className={cn(editorFormSurfaceClass, 'flex items-center justify-between gap-3 rounded-2xl px-4 py-2')}><span className="min-w-0 truncate text-xs font-semibold"><span className="mr-2 text-muted-foreground">{i + 1}.</span>{blocks.find(b => b.id === id)?.label}</span><div className="flex shrink-0"><Button variant="ghost" size="icon" aria-label={`Move ${blocks.find(b => b.id === id)?.label} up`} disabled={i === 0} onClick={() => moveBlock(i, -1)}><ArrowUp className="size-3.5" /></Button><Button variant="ghost" size="icon" aria-label={`Move ${blocks.find(b => b.id === id)?.label} down`} disabled={i === order.length - 1} onClick={() => moveBlock(i, 1)}><ArrowDown className="size-3.5" /></Button></div></div>)}</section>
      <section className="space-y-4"><div className="flex items-center justify-between"><h3 className="text-sm font-bold">Sections</h3><Button variant="ghost" className={cn(smallAction, 'text-primary')} disabled={!canNest} onClick={() => setAddingSection(true)}><Plus className="mr-2 size-3.5" />Add section</Button></div>
        {addingSection && <form className={cn(editorFormSurfaceClass, 'flex gap-2 rounded-2xl p-3')} onSubmit={e => { e.preventDefault(); if (!sectionName.trim()) return; const id = newID(); update({ ...folder, sections: [...sections, { id, title: sectionName.trim(), tileShape: 'LANDSCAPE', folders: [] }], blockOrder: [...order, `section:${id}`] }); setSectionName(''); setAddingSection(false); }}><Input autoFocus aria-label="New section title" placeholder="e.g. Explore by genre" value={sectionName} onChange={e => setSectionName(e.target.value)} /><Button type="submit" disabled={!sectionName.trim()}>Add</Button><Button variant="ghost" type="button" onClick={() => setAddingSection(false)}>Cancel</Button></form>}
        {!sections.length && <p className="rounded-2xl border border-dashed border-border/60 p-5 text-xs text-muted-foreground">Sections group folder cards in a horizontal row, like your Home widgets.</p>}
        {sections.map((section, i) => <section key={section.id} className={cn(editorPanelClass, 'space-y-4 bg-muted/10 p-4 sm:p-5')}><div className="flex items-start gap-2"><div className="min-w-0 flex-1">{labeledInput('Section title', section.title, title => sectionChange(i, { title }))}</div><Button variant="ghost" size="icon" aria-label={`Delete section ${section.title}`} className="mt-6 text-destructive/70" onClick={() => setPendingDelete(section)}><Trash2 className="size-4" /></Button></div><div className="flex flex-wrap items-center justify-between gap-3"><ShapePicker label="Section tiles" value={section.tileShape ?? 'LANDSCAPE'} onChange={tileShape => sectionChange(i, { tileShape })} /><label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={section.homeEnabled !== false} onChange={e => sectionChange(i, { homeEnabled: e.target.checked })} />Enabled</label></div><FolderList folders={section.folders} depth={depth + 1} onChange={folders => sectionChange(i, { folders })} /></section>)}
        {removedSection && <Button variant="ghost" className={smallAction} onClick={() => { const next = [...sections]; next.splice(Math.min(removedSection.index, next.length), 0, removedSection.section); update({ ...folder, sections: next }); setRemovedSection(null); }}><RotateCcw className="mr-2 size-3.5" />Restore {removedSection.section.title}</Button>}
      </section>
      <section className={cn(editorPanelClass, 'space-y-4 bg-muted/10 p-4 sm:p-5')}><h3 className="text-sm font-bold">Subfolder grid</h3><ShapePicker label="Grid tiles" value={String(folder.subfolderTileShape ?? 'POSTER')} onChange={subfolderTileShape => update({ ...folder, subfolderTileShape })} />{canNest ? <FolderList folders={folder.subfolders ?? []} depth={depth + 1} onChange={subfolders => update({ ...folder, subfolders })} /> : <p className="text-xs text-muted-foreground">This is the deepest folder level. Add catalogs here, or add more folders one level above.</p>}</section>
      <details className={cn(editorPanelClass, 'bg-muted/10 p-5')}><summary className="cursor-pointer text-sm font-bold">Appearance &amp; playback</summary><div className="mt-4 grid gap-4 sm:grid-cols-2">{labeledInput('Animated cover URL', folder.focusVideoUrl, focusVideoUrl => update({ ...folder, focusVideoUrl, focusGifEnabled: !!focusVideoUrl }))}{labeledInput('Hero background URL', folder.heroBackdropUrl, heroBackdropUrl => update({ ...folder, heroBackdropUrl }))}{labeledInput('Title logo URL', folder.titleLogoUrl, titleLogoUrl => update({ ...folder, titleLogoUrl }))}<label className="space-y-2 text-xs text-muted-foreground"><span className="block">Folder view</span><select aria-label="Folder view" className="h-10 w-full rounded-xl border border-border/60 bg-background px-3" value={String(folder.viewMode ?? 'ROWS')} onChange={e => update({ ...folder, viewMode: e.target.value })}><option value="ROWS">Rows</option><option value="TABBED_GRID">Tabs &amp; grid</option><option value="FOLLOW_LAYOUT">Follow layout</option></select></label><label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={folder.homeEnabled !== false} onChange={e => update({ ...folder, homeEnabled: e.target.checked })} />Folder enabled</label></div></details>
      <p className="text-[11px] leading-relaxed text-muted-foreground">Nested hub pages work on iOS and macOS. The current Luma tvOS browser still needs support for nested pages.</p>
    </div><footer className="shrink-0 border-t border-border/40 p-5 text-right"><Button className={cn(editorActionButtonClass, editorFooterPrimaryButtonClass, 'px-8')} onClick={() => setOpen(false)}><Check className="mr-2 size-4" />Done</Button></footer>
  </div>;
  return <><div className="mt-5 rounded-2xl border border-primary/15 bg-primary/5 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="text-xs font-bold">Hub page</h4><p className="mt-1 text-[11px] text-muted-foreground">{sections.length} sections · {folder.subfolders?.length ?? 0} subfolders</p></div><Button variant="ghost" className={cn(smallAction, 'border-primary/20 text-primary')} onClick={() => setOpen(true)}><FolderOpen className="mr-2 size-4" />Edit hub page</Button></div></div>
    {mobile ? <Drawer open={open} onOpenChange={setOpen}><DrawerContent className="max-h-[96dvh] overflow-hidden border-border bg-background"><DrawerTitle className="sr-only">Hub page: {item.name}</DrawerTitle><DrawerDescription className="sr-only">Edit nested folders and sections.</DrawerDescription><div className="flex h-[90dvh] min-h-0 flex-col">{content}</div></DrawerContent></Drawer> : <Dialog open={open} onOpenChange={setOpen}><DialogContent className="flex h-[85dvh] max-h-[900px] flex-col overflow-hidden rounded-3xl border-border bg-background p-0 sm:max-w-[64rem]"><DialogTitle className="sr-only">Hub page: {item.name}</DialogTitle><DialogDescription className="sr-only">Edit nested folders and sections.</DialogDescription>{content}</DialogContent></Dialog>}
    <ConfirmationDialog isOpen={!!pendingDelete} onOpenChange={v => { if (!v) setPendingDelete(null); }} title="Delete section?" description={`Remove “${pendingDelete?.title}” and its folders? You can restore it from this page.`} confirmText="Delete section" onConfirm={() => { if (!pendingDelete) return; setRemovedSection({ section: pendingDelete, index: sections.findIndex(s => s.id === pendingDelete.id) }); update({ ...folder, sections: sections.filter(s => s.id !== pendingDelete.id) }); setPendingDelete(null); }} variant="danger" />
  </>;
}
