'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, Ellipsis, Eye, Film, FolderOpen, House, Plus, Search, Undo2, X } from 'lucide-react';
import { useMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AnimationPreview, ArtworkPreview } from '@/components/editor/ArtworkPreview';
import { LumaCatalogEditor } from '@/components/editor/LumaCatalogEditor';
import { MAX_DEPTH, type CatalogSource, type Folder } from '@/lib/luma-document';
import type { SyncProfileDraft, SyncHomeRow } from '@/lib/luma-sync/documents';
import {
  addHomeItem, canMoveHome, canReorderHome, deleteHomeNode, duplicateHomeNode, homeNodeValue, homeTree,
  moveHomeNode, reorderHome, setHomeNodeHidden, updateHomeNode, walkHome, type HomeNode,
} from '@/lib/luma-sync/home-tree';
import { HomeCatalogPreview, catalogDisplay, nodeCatalog, trustedArt } from './HomeCatalogPreview';
import { CatalogManifestImport, SyncCatalogPicker, useCatalogIdentity } from './SyncCatalogs';
import { SortableRow, SortableRows } from './SortableRows';

const labels: Record<HomeNode['kind'], string> = {
  hub: 'Folder row', folder: 'Folder', section: 'Folder row', group: 'Catalog section', widget: 'Widget', catalog: 'Catalog',
};
const containers = (node?: HomeNode) => node?.children !== undefined;
const formatCount = (n: number, label: string) => `${n} ${label}${n === 1 ? '' : 's'}`;
const pageSize = 48;
type AddType = Parameters<typeof addHomeItem>[2];
type Task = { mode: 'add' } | { mode: 'edit' | 'delete' | 'move'; key: string };
type HomeParts = Pick<SyncProfileDraft, 'home' | 'collections'>;

function CatalogOrFolderTitle(node: HomeNode, resolve: ReturnType<typeof useCatalogIdentity>) {
  return node.kind === 'catalog' || node.kind === 'widget' ? catalogDisplay(node, resolve).title : node.title;
}
function ownImage(node: HomeNode) {
  return node.folder?.coverImageUrl || node.folder?.cover_image_url;
}
function nodeImage(node: HomeNode): unknown {
  const own = ownImage(node);
  if (own) return own;
  for (const child of node.children ?? []) {
    if (child.hidden) continue;
    const cover = nodeImage(child);
    if (trustedArt(cover)) return cover;
  }
}
function Cover({ node, large = false, shape }: { node: HomeNode; large?: boolean; shape?: string }) {
  const raw = nodeImage(node), automatic = trustedArt(raw);
  const className = large ? 'home-cover-large' : 'home-cover';
  const cardShape = (node.folder?.tileShape || shape || '').toUpperCase();
  return <span className={className} data-cover-shape={cardShape}>
    {automatic || large && raw
      ? <ArtworkPreview src={automatic || raw} onDemand={!automatic} className="home-artwork" />
      : <span className="home-cover-empty">{node.children ? <FolderOpen aria-hidden /> : <Film aria-hidden />}</span>}
  </span>;
}
function folderDetails(node: HomeNode) {
  const children = node.children ?? [];
  const folders = children.filter(child => child.kind === 'folder' && !child.hidden).length;
  const catalogs = children.filter(child => !child.children && !child.hidden).length;
  const sections = children.filter(child => (child.kind === 'group' || child.kind === 'section') && !child.hidden).length;
  return [folders > 0 && formatCount(folders, 'folder'), catalogs > 0 && formatCount(catalogs, 'catalog'),
    sections > 0 && formatCount(sections, 'section')].filter(Boolean).join(' · ');
}

function HomePreview({ nodes }: { nodes: HomeNode[] }) {
  const [open, setOpen] = useState(false), [trail, setTrail] = useState<HomeNode[]>([]), [selected, setSelected] = useState<HomeNode>();
  const [page, setPage] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const resolve = useCatalogIdentity();
  const parent = trail.at(-1);
  const level = (parent?.children ?? nodes).filter(node => !node.hidden && (!node.hub || node.children?.some(child => !child.hidden)));
  const visible = level.slice(page * 12, (page + 1) * 12);
  function go(path: HomeNode[]) {
    setTrail(path); setSelected(undefined); setPage(0);
    requestAnimationFrame(() => heading.current?.focus());
  }
  return <Dialog open={open} onOpenChange={value => { setOpen(value); if (value) go([]); }}>
    <DialogTrigger asChild><Button type="button" variant="outline"><Eye />Preview Home</Button></DialogTrigger>
    <DialogContent className="home-preview-dialog">
      <DialogTitle ref={heading} tabIndex={-1}>{parent?.title ?? 'Home preview'}</DialogTitle>
      <DialogDescription>Visible items in this draft. Content can vary by device.</DialogDescription>
      {parent && <nav aria-label="Preview path" className="home-path">
        <Button type="button" variant="ghost" onClick={() => go([])}>Home</Button>
        {trail.map((node, i) => i === trail.length - 1 ? <span key={node.key} aria-current="page">{node.title}</span>
          : <Button key={node.key} type="button" variant="ghost" onClick={() => go(trail.slice(0, i + 1))}>{node.title}</Button>)}
      </nav>}
      {parent?.folder?.openTarget === 'tmdb_person' ? <p className="sync-empty">Opens a person page in Luma.</p> :
        <>
          {!level.length && <p className="sync-empty">Nothing visible here yet.</p>}
          <div className="home-layout-preview">{visible.map(node => node.hub ? <section key={node.key}>
            <h3 className={node.hub.hideTitle ? 'sr-only' : ''}>{node.title}</h3>
            <div className="home-preview-folders">{node.children?.filter(child => !child.hidden).slice(0, 8).map(folder =>
              <button className="home-preview-tile" key={folder.key} type="button" onClick={() => go([...trail, node, folder])} aria-label={`Open ${folder.title}`}>
                <Cover node={folder} /><span className={folder.folder?.hideTitle ?? node.hub?.showFolderNames === false ? 'sr-only' : ''}>{folder.title}</span>
              </button>)}</div>
            <Button type="button" size="sm" variant="ghost" onClick={() => go([...trail, node])}>Open {node.title}<ChevronRight /></Button>
          </section> : <button className="home-preview-tile" key={node.key} type="button" onClick={() => containers(node) ? go([...trail, node]) : setSelected(node)}>
            <Cover node={node} /><span>{CatalogOrFolderTitle(node, resolve)}</span><ChevronRight aria-hidden />
          </button>)}</div>
          <Pages page={page} count={level.length} size={12} change={setPage} />
          {selected && <section className="home-preview-panel" aria-label="Selected catalog"><h3>{CatalogOrFolderTitle(selected, resolve)}</h3>
            <HomeCatalogPreview key={selected.key} node={selected} /></section>}
        </>}
    </DialogContent>
  </Dialog>;
}
function Pages({ page, count, size = pageSize, change }: { page: number; count: number; size?: number; change: (page: number) => void }) {
  if (count <= size) return null;
  return <nav className="sync-row-actions" aria-label="Page navigation">
    <Button type="button" size="sm" variant="outline" disabled={page === 0} onClick={() => change(page - 1)}>Previous</Button>
    <span className="sync-meta" role="status">{page * size + 1}–{Math.min((page + 1) * size, count)} of {count}</span>
    <Button type="button" size="sm" variant="outline" disabled={(page + 1) * size >= count} onClick={() => change(page + 1)}>Next</Button>
  </nav>;
}

export function HomeEditor({ draft, change, revision, actions, disabled }: {
  draft: SyncProfileDraft; change: (next: SyncProfileDraft) => void; revision: unknown;
  actions: (change: (next: SyncProfileDraft) => void) => ReactNode; disabled: boolean;
}) {
  const mobile = useMobile();
  const [location, setLocation] = useState(''), [selected, setSelected] = useState(''), [showHidden, setShowHidden] = useState(false);
  const [menu, setMenu] = useState(''), [sorting, setSorting] = useState(false);
  const [query, setQuery] = useState(''), [page, setPage] = useState(0), [task, setTask] = useState<Task>();
  const [history, setHistory] = useState<{ revision: unknown; before: HomeParts; after: HomeParts; location: string; selected: string; page: number }[]>([]);
  const [status, setStatus] = useState(''), [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null), root = useRef<HTMLElement>(null);
  const taskOpener = useRef<HTMLElement | null>(null);
  const scroll = useRef(new Map<string, { page: number; y: number }>());
  const { home, collections } = draft;
  const nodes = useMemo(() => homeTree({ home, collections }), [home, collections]);
  const index = useMemo(() => {
    const value = new Map<string, { node: HomeNode; parents: HomeNode[] }>();
    walkHome(nodes, (node, parents) => value.set(node.key, { node, parents }));
    return value;
  }, [nodes]);
  const resolve = useCatalogIdentity();
  const title = (node: HomeNode) => CatalogOrFolderTitle(node, resolve);
  const active = index.get(location), parent = active?.node;
  const level = parent?.children ?? nodes;
  const parentArt = parent && ownImage(parent);
  const preview = level.find(node => node.key === selected && (showHidden || !node.hidden)) ??
    (parentArt && (!trustedArt(parentArt) || !level.length) ? parent : undefined);
  const search = query.trim().toLocaleLowerCase();
  const results = search ? [...index.values()].filter(({ node, parents }) =>
    (!parent || parents.some(ancestor => ancestor.key === parent.key)) &&
    [title(node), node.kind, ...parents.slice(parent ? parents.findIndex(ancestor => ancestor.key === parent.key) + 1 : 0).map(item => item.title), nodeCatalog(node).id, nodeCatalog(node).addon,
      !containers(node) && catalogDisplay(node, resolve).detail].filter(Boolean).join(' ').toLocaleLowerCase().includes(search)).map(({ node }) => node)
    : level.filter(node => showHidden || !node.hidden);
  const actualPage = Math.min(page, Math.max(0, Math.ceil(results.length / pageSize) - 1));
  const displayed = results.slice(actualPage * pageSize, (actualPage + 1) * pageSize);
  const hiddenCount = level.filter(node => node.hidden).length;
  const grid = !search && (parent?.kind === 'hub' || parent?.kind === 'section' || displayed.length > 0 && displayed.every(node => node.kind === 'folder'));
  const shapeFor = (node: HomeNode) => node.folder?.tileShape || parent?.section?.tileShape ||
    (typeof parent?.folder?.subfolderTileShape === 'string' ? parent.folder.subfolderTileShape : undefined);
  const portraitGrid = grid && displayed.length > 0 && displayed.every(node => shapeFor(node)?.toUpperCase() === 'POSTER');
  const reorderable = !search && displayed.some((node, i) => displayed.slice(i + 1).some(next => canReorderHome(node, next, parent)));
  const arranging = sorting && reorderable && !disabled;
  const editing = task && task.mode !== 'add' ? index.get(task.key)?.node : undefined;
  const undo = history.at(-1);
  const canUndo = !!undo && undo.revision === revision && undo.after.home === draft.home && undo.after.collections === draft.collections;

  function navigate(key: string, item = '', restore = false, hidden = false) {
    scroll.current.set(location, { page: actualPage, y: window.scrollY });
    const saved = restore ? scroll.current.get(key) : undefined;
    const targetLevel = index.get(key)?.node.children ?? nodes;
    const visible = targetLevel.filter(node => hidden || !node.hidden);
    const itemIndex = visible.findIndex(node => node.key === item);
    setLocation(key); setQuery(''); setSelected(item); setPage(saved?.page ?? (itemIndex < 0 ? 0 : Math.floor(itemIndex / pageSize)));
    setShowHidden(hidden); setSorting(false); setTask(undefined); setMenu(''); setError('');
    taskOpener.current = null;
    requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
      if (saved) window.scrollTo({ top: saved.y });
      else heading.current?.scrollIntoView({ block: 'start' });
    });
  }
  function commit(next: SyncProfileDraft, feedback = 'Draft updated.') {
    if (disabled || next === draft) return;
    setHistory(list => [...(canUndo ? list.slice(-19) : []), {
      revision, before: { home: draft.home, collections: draft.collections }, after: { home: next.home, collections: next.collections },
      location, selected, page: actualPage,
    }]);
    change(next); setStatus(feedback); setError('');
  }
  function perform(work: () => SyncProfileDraft, feedback?: string, close = false) {
    try {
      commit(work(), feedback);
      if (close) setTask(undefined);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not apply the change.'); }
  }
  function goTo(node: HomeNode) {
    if (containers(node)) navigate(node.key);
    else if (search) navigate(index.get(node.key)?.parents.at(-1)?.key ?? '', node.key, false, node.hidden);
    else {
      if (selected === node.key) { setSelected(''); setStatus('Preview closed.'); return; }
      setSelected(node.key);
      setStatus(`Preview: ${title(node)}.`);
      if (mobile) requestAnimationFrame(() =>
        root.current?.querySelector('#home-selection')?.scrollIntoView({ block: 'start' }));
    }
  }
  function openTask(next: Task, opener?: HTMLElement) {
    taskOpener.current = opener ?? [...(root.current?.querySelectorAll<HTMLElement>('[data-home-actions]') ?? [])]
      .find(element => next.mode !== 'add' && element.dataset.homeActions === next.key) ?? null;
    setError(''); setTask(next);
  }
  function reorder(a: HomeNode, b: HomeNode) {
    perform(() => reorderHome(draft, a, b, parent), `${title(a)} reordered.`);
  }
  function undoLast() {
    if (!canUndo || !undo || disabled) return;
    change({ ...draft, ...undo.before });
    setHistory(history.slice(0, -1)); setLocation(undo.location); setSelected(undo.selected); setPage(undo.page);
    setQuery(''); setStatus('Change undone.'); setError('');
  }

  const selection = preview && !search && <aside className="home-preview-panel" id="home-selection" aria-label="Item preview">
    <div className="home-preview-head"><div><p className="sync-meta">{containers(preview) ? 'Cover preview' : 'Catalog preview'}</p><h3>{title(preview)}</h3></div>
      {preview.key === selected && <Button type="button" size="sm" variant="ghost" onClick={() => {
        setSelected('');
        const trigger = [...(root.current?.querySelectorAll<HTMLElement>('[data-home-open]') ?? [])].find(element => element.dataset.homeOpen === preview.key);
        (trigger ?? heading.current)?.focus();
      }}>Close</Button>}</div>
    {containers(preview) ? <Cover node={preview} large /> : <>
      <p className="sync-meta">{catalogDisplay(preview, resolve).detail}</p><HomeCatalogPreview key={preview.key} node={preview} />
    </>}
  </aside>;

  const card = (node: HomeNode, i: number, grip?: ReactNode) => {
    const display = containers(node) || node.kind === 'hub' ? undefined : catalogDisplay(node, resolve);
    const detail = [!(grid && node.kind === 'folder') && labels[node.kind], display?.detail || folderDetails(node) || (grid && 'Empty'), node.hub?.pinToTop === true && 'Pinned',
      node.hidden && 'Hidden', node.section?.dynamicSource && 'Device folders'].filter(Boolean).join(' · ');
    const path = index.get(node.key)?.parents.map(item => item.title).join(' › ');
    const sibling = (direction: number) => {
      for (let at = i + direction; at >= 0 && at < displayed.length; at += direction) {
        if (canReorderHome(node, displayed[at], parent)) return displayed[at];
      }
    };
    const up = search ? undefined : sibling(-1), down = search ? undefined : sibling(1);
    return <><div className={`home-card${node.key === selected ? ' home-selected' : ''}${node.hidden ? ' home-muted' : ''}`}>
      <button type="button" className="home-card-open" data-home-open={node.key} aria-label={`${containers(node) ? 'Open' : 'Preview'} ${title(node)}`}
        aria-expanded={containers(node) || search ? undefined : selected === node.key} onClick={() => goTo(node)}>
        <Cover node={node} shape={shapeFor(node)} />
        <span className="home-card-copy"><strong>{title(node)}</strong><span className="home-card-detail">{detail}</span>
          {search && <span className="home-result-path">Home{path ? ' › ' + path : ''}</span>}</span>
        {!grid && (containers(node) ? <ChevronRight aria-hidden /> : <Eye aria-hidden />)}
      </button>
      <div className="home-card-actions">{grip ?? (!arranging &&
      <Popover open={menu === node.key} onOpenChange={open => setMenu(open ? node.key : '')}><PopoverTrigger asChild><Button type="button" size="icon" variant="ghost" className="home-card-menu" disabled={disabled} data-home-actions={node.key} aria-label={`Actions for ${title(node)}`}><Ellipsis /></Button></PopoverTrigger>
        <PopoverContent align="end" className="home-node-menu" onClick={() => setMenu('')} onCloseAutoFocus={event => {
          if (taskOpener.current) event.preventDefault();
        }}>
          {homeNodeValue(node) && <Button type="button" variant="ghost" onClick={() => openTask({ mode: 'edit', key: node.key })}>Edit details</Button>}
          <Button type="button" variant="ghost" onClick={() => perform(() => setHomeNodeHidden(draft, node, !node.hidden), node.hidden ? 'Item shown.' : 'Item hidden.')}>{node.hidden ? 'Show here' : 'Hide'}</Button>
          {(node.folder || node.source || node.kind === 'widget') && <Button type="button" variant="ghost" onClick={() => openTask({ mode: 'move', key: node.key })}>Move to…</Button>}
          {node.kind !== 'group' && (node.kind !== 'hub' || node.hub) && <Button type="button" variant="ghost" onClick={() => perform(() => duplicateHomeNode(draft, node), 'Copy added.')}>Duplicate</Button>}
          {up && <Button type="button" variant="ghost" onClick={() => reorder(node, up)}><ArrowUp />Move up</Button>}
          {down && <Button type="button" variant="ghost" onClick={() => reorder(node, down)}><ArrowDown />Move down</Button>}
          {node.kind !== 'catalog' || node.source ? <Button type="button" variant="ghost" className="home-menu-delete text-destructive" onClick={() => openTask({ mode: 'delete', key: node.key })}>Delete</Button> : null}
        </PopoverContent></Popover>)}</div>
    </div>{mobile && preview?.key === node.key && selection}</>;
  };
  return <section ref={root} className="sync-panel home-workspace" aria-labelledby="home-title">
    <div className="home-editor-top">
      <nav aria-label="Home location" className="home-path">
        {parent && <Button type="button" variant="ghost" onClick={() => navigate('', '', true)}><House />Home</Button>}
        {active?.parents.map(node => <span key={node.key}><ChevronRight aria-hidden /><Button type="button" variant="ghost" onClick={() => navigate(node.key, '', true)}>{node.title}</Button></span>)}
        {parent && <span aria-current="page"><ChevronRight aria-hidden />{parent.title}</span>}
      </nav>
      <div className="home-editor-heading"><div><h2 id="home-title" ref={heading} tabIndex={-1}>{parent?.title || 'Home'}</h2>
        <p className="sync-meta">{search ? formatCount(results.length, 'result') : formatCount(level.filter(node => !node.hidden).length, 'item') + (parent ? ' here' : ' on Home')}</p></div>
        <div className="home-toolbar">
          {!parent && <><HomePreview nodes={nodes} />{actions(commit)}</>}
          {canUndo && <Button type="button" variant="ghost" disabled={disabled} onClick={undoLast}><Undo2 />Undo</Button>}
          {parent?.folder?.openTarget !== 'tmdb_person' && <Button type="button" disabled={disabled} onClick={event => openTask({ mode: 'add' }, event.currentTarget)}><Plus />Add here</Button>}
        </div>
      </div>
      <div className="home-tools">
        <div className="home-search"><Search aria-hidden /><Input type="search" aria-label={parent ? `Search in ${parent.title}` : 'Search Home'} placeholder={parent ? `Search in ${parent.title}` : 'Search Home'}
          value={query} onChange={e => { setQuery(e.target.value); setPage(0); setSorting(false); }} />
          {query && <Button type="button" size="icon" variant="ghost" aria-label="Clear search" onClick={event => {
            const input = event.currentTarget.parentElement?.querySelector('input');
            setQuery(''); setPage(0); input?.focus();
          }}><X /></Button>}
        </div>
        <div className="home-view-actions">
          {!search && (hiddenCount > 0 || showHidden) && <Button type="button" variant="ghost" aria-pressed={showHidden} onClick={() => { setShowHidden(!showHidden); setPage(0); setSorting(false); }}>{showHidden ? 'Hide hidden items' : `Show hidden (${hiddenCount})`}</Button>}
          {parent && <Button type="button" variant="ghost" disabled={disabled || arranging} onClick={event => openTask({ mode: 'edit', key: parent.key }, event.currentTarget)}>
            {parent.kind === 'hub' || parent.kind === 'section' ? 'Row settings' : parent.kind === 'group' ? 'Section settings' : 'Folder settings'}
          </Button>}
          {reorderable && <Button type="button" variant={arranging ? 'outline' : 'ghost'} disabled={disabled} onClick={() => { setSorting(!arranging); setMenu(''); }}><ArrowUpDown />{arranging ? 'Done reordering' : 'Reorder'}</Button>}
        </div>
      </div>
    </div>
    {error && !task && <p role="alert" className="sync-banner sync-error">{error}</p>}
    <p className="sr-only" role="status">{status}</p>
    <div className={`home-columns${preview && !mobile && !search ? ' home-has-preview' : ''}`}>
      <div className="min-w-0">
        {parent?.folder?.openTarget === 'tmdb_person' && <p className="sync-empty">This folder opens a TMDB person page in Luma.</p>}
        {parent?.section?.dynamicSource && <p className="sync-empty">Additional folders load on your Luma device.</p>}
        {!displayed.length && !parent?.folder?.openTarget && <div className="home-empty"><FolderOpen aria-hidden /><p>{search ? 'No matching items.' : 'Nothing here yet.'}</p>
          {!search && <span>{hiddenCount ? 'Show hidden items to see what is saved here.' : 'Add a folder or catalog to start.'}</span>}</div>}
        <div className={grid ? 'home-folder-grid' : 'home-list'} data-card-density={portraitGrid ? 'poster' : undefined} data-testid="home-current-level">
          <SortableRows grid={grid} ids={arranging ? displayed.filter(node => !node.hidden).map(node => node.key) : []} reorder={(from, to) => {
            const visible = displayed.filter(node => !node.hidden);
            if (visible[from] && visible[to]) reorder(visible[from], visible[to]);
          }}>
            {displayed.map((node, i) => arranging && !node.hidden ?
              <SortableRow key={node.key} id={node.key} label={title(node)}>{handle => card(node, i, handle)}</SortableRow>
              : <div key={node.key}>{card(node, i)}</div>)}
          </SortableRows>
        </div>
        <Pages page={actualPage} count={results.length} change={next => { setPage(next); heading.current?.focus(); }} />
      </div>
      {(!mobile || preview?.key === parent?.key) && selection}
    </div>
    <Dialog open={!!task} onOpenChange={open => { if (!open) { setTask(undefined); setError(''); } }}>
      {task && <DialogContent className="home-task" onCloseAutoFocus={event => {
        event.preventDefault();
        const opener = taskOpener.current;
        taskOpener.current = null;
        if (opener) requestAnimationFrame(() => (opener.isConnected ? opener : heading.current)?.focus({ preventScroll: true }));
      }}>
        <DialogTitle>{task.mode === 'add' ? `Add to ${parent?.title ?? 'Home'}` : task.mode === 'edit' ? `Edit ${editing ? title(editing) : 'item'}` :
          task.mode === 'move' ? `Move ${editing ? title(editing) : 'item'}` : `Delete ${editing ? title(editing) : 'item'}?`}</DialogTitle>
        <DialogDescription>{task.mode === 'move' ? 'Choose a destination for this item.' : task.mode === 'delete'
          ? `${editing?.children?.length ? formatCount(editing.children.length, 'direct item') + ' and any contents will be removed. ' : ''}You can undo this before saving.`
          : <span className="sr-only">Changes are applied to your draft.</span>}</DialogDescription>
        {error && <p role="alert" className="sync-banner sync-error">{error}</p>}
        <fieldset disabled={disabled} className="grid min-w-0 gap-3">
          {task.mode === 'add' && <AddItem parent={parent} submit={(kind, name, source) => {
            try {
              const added = addHomeItem(draft, parent, kind, name, source);
              const next = (location ? findNode(homeTree(added.draft), location)?.children : homeTree(added.draft)) ?? [];
              const key = next.find(node => (homeNodeValue(node) as { id?: string } | undefined)?.id === added.id || node.row?.id === 'widget:' + added.id)?.key;
              commit(added.draft, 'Added to ' + (parent?.title ?? 'Home') + '.');
              setTask(undefined); setQuery('');
              setSelected('');
              if (key) setPage(Math.max(0, Math.floor(next.filter(node => !node.hidden || showHidden).findIndex(node => node.key === key) / pageSize)));
            } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not add this item.'); }
          }} />}
          {task.mode === 'edit' && editing && <EditItem node={editing} save={updates => perform(() =>
            updateHomeNode(draft, editing, updates), 'Details updated.', true)} />}
          {task.mode === 'move' && editing && <MoveItem node={editing} index={index} submit={target => {
            try {
              const next = moveHomeNode(draft, editing, target);
              commit(next, `Moved to ${target?.title ?? 'Home'}.`);
              navigate(target?.key ?? '', '', false, editing.hidden);
            } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not move this item.'); }
          }} />}
          {task.mode === 'delete' && editing && <Button type="button" variant="destructive" onClick={() =>
            perform(() => deleteHomeNode(draft, editing), 'Item removed.', true)}>Delete item</Button>}
        </fieldset>
      </DialogContent>}
    </Dialog>
  </section>;
}
function findNode(nodes: HomeNode[], key: string) {
  let match: HomeNode | undefined;
  walkHome(nodes, node => { if (node.key === key) match = node; });
  return match;
}

function Field({ label, value, set, maxLength = 1024 }: { label: string; value: unknown; set: (value: string) => void; maxLength?: number }) {
  return <label className="home-field"><span>{label}</span><Input value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
    maxLength={maxLength} onChange={event => set(event.target.value)} /></label>;
}
function Toggle({ label, checked, set }: { label: string; checked: boolean; set: (value: boolean) => void }) {
  return <label className="home-check"><input type="checkbox" checked={checked} onChange={event => set(event.target.checked)} />{label}</label>;
}
function Choice({ label, value, values, set }: { label: string; value: unknown; values: [string, string][]; set: (value: string) => void }) {
  const selected = typeof value === 'string' ? value : '';
  return <label className="home-field"><span>{label}</span><select aria-label={label} value={selected} onChange={event => set(event.target.value)}>
    {!values.some(([key]) => key === selected) && <option value={selected}>{selected || 'Default'}</option>}
    {values.map(([key, text]) => <option value={key} key={key}>{text}</option>)}</select></label>;
}
const tileShapes: [string, string][] = [['', 'Use default'], ['LANDSCAPE', 'Wide'], ['POSTER', 'Poster'], ['SQUARE', 'Square']];
const folderViews: [string, string][] = [['', 'Use default'], ['ROWS', 'One row per catalog'], ['TABBED_GRID', 'Tabs and poster grid'], ['FOLLOW_LAYOUT', 'Follow Luma layout']];
function AddItem({ parent, submit }: { parent?: HomeNode; submit: (kind: AddType, name: string, source?: CatalogSource) => void }) {
  const catalogAllowed = !parent || !!parent.folder || !!parent.group;
  const foldersAllowed = !parent || parent.depth < MAX_DEPTH && !parent.group;
  const [kind, setKind] = useState<AddType>(foldersAllowed ? parent ? 'folder' : 'hub' : 'catalog');
  const [name, setName] = useState('');
  const [provider, setProvider] = useState('addon'), [addon, setAddon] = useState(''), [type, setType] = useState('movie'), [id, setID] = useState('');
  const [manual, setManual] = useState(false);
  const options: [AddType, string][] = [];
  if (foldersAllowed) options.push(parent ? ['folder', 'Folder'] : ['hub', 'Folder row']);
  if (parent?.folder && parent.depth < MAX_DEPTH) options.push(['section', 'Folder row']);
  if (catalogAllowed) options.push(['catalog', parent ? 'Catalog' : 'Widget']);
  if (parent?.folder) options.push(['group', 'Catalog section']);
  return <>
    {options.length > 1 && <div className="sync-choice-bar" role="group" aria-label="What to add">
      {options.map(([key, label]) => <Button key={key} type="button" variant="ghost" aria-pressed={kind === key}
        onClick={() => { setKind(key); setName(''); setManual(false); }}>{label}</Button>)}
    </div>}
    {kind === 'catalog' && <>
      <SyncCatalogPicker label="Choose catalog" onSelect={route => submit('catalog', '', {
        provider: 'addon', addonId: route.addonID, catalogId: route.catalogID, type: route.mediaType,
        title: route.title || undefined,
      })} />
      <details className="home-task-more" open={manual || undefined}>
        <summary>Other ways to add a catalog</summary>
        <CatalogManifestImport />
        <Button type="button" variant="ghost" aria-expanded={manual} onClick={() => setManual(!manual)}>Add by ID</Button>
      </details>
      {manual && <>
        {parent && <Choice label="Provider" value={provider} values={[['addon', 'Add-on'], ['jellyfin', 'Jellyfin'], ['tmdb', 'TMDB'], ['trakt', 'Trakt']]} set={setProvider} />}
        <Field label="Display name" value={name} set={setName} />
        {['addon', 'jellyfin'].includes(provider) && <Field label="Manifest or server ID" value={addon} set={setAddon} />}
        <Field label="Media type" value={type} set={setType} />
        <Field label={provider === 'tmdb' ? 'TMDB list ID' : provider === 'trakt' ? 'Trakt list ID' : 'Catalog ID'} value={id} set={setID} />
        <Button type="button" disabled={!id.trim() || !type.trim() || ['addon', 'jellyfin'].includes(provider) && !addon.trim()}
          onClick={() => submit('catalog', '', {
            provider, title: name.trim(), type: type.trim(),
            ...(provider === 'tmdb' ? { tmdbSourceType: 'LIST', tmdbId: Number(id) } : provider === 'trakt' ? { traktListId: Number(id) } :
              { addonId: addon.trim(), catalogId: id.trim() }),
          })}>Add catalog</Button>
      </>}
    </>}
    {kind !== 'catalog' && <form className="grid gap-3" onSubmit={event => { event.preventDefault(); if (name.trim()) submit(kind, name.trim()); }}>
      <Field label="Name" value={name} set={setName} />
      <Button type="submit" disabled={!name.trim()}>Create {options.find(([key]) => key === kind)?.[1].toLowerCase()}</Button>
    </form>}
  </>;
}
function EditItem({ node, save }: { node: HomeNode; save: (updates: object) => void }) {
  const original = homeNodeValue(node);
  const [value, setValue] = useState<Record<string, unknown>>({ ...original });
  const [sourceFolder, setSourceFolder] = useState<Folder>(() => ({ id: 'details', title: 'Details', sources: node.source ? [node.source] : [] }));
  const update = (key: string, entry: unknown) => setValue(previous => ({ ...previous, [key]: entry }));
  const field = (label: string, key: string, maxLength?: number) => <Field label={label} value={value[key]} maxLength={maxLength} set={text => update(key, text)} />;
  const flag = (label: string, key: string, defaultValue = false) => <Toggle label={label} checked={typeof value[key] === 'boolean' ? value[key] as boolean : defaultValue} set={v => update(key, v)} />;
  const pick = (label: string, key: string, values: [string, string][]) => <Choice label={label} value={value[key]} values={values} set={v => update(key, v || undefined)} />;
  const widget = value.widget as Record<string, unknown> | undefined;
  const setWidget = (key: string, v: unknown) => update('widget', { ...widget, [key]: v });
  const route = value.source as SyncHomeRow['source'] | undefined;
  const putSource = (key: keyof SyncHomeRow['source'], text: string) => update('source', { ...route, [key]: text });
  const disabled = !node.row && !node.source && !String(value.title ?? '').trim() ||
    node.kind === 'widget' && (!route?.addonID || !route.catalogID || !route.mediaType);
  return <>
    {!node.source && field(node.row && !node.hub ? 'Display name' : 'Name', 'title')}
    {node.hub && <>{flag('Pin to top of Home', 'pinToTop')}{flag('Hide row title in Luma', 'hideTitle')}
      {flag('Show folder names in Luma', 'showFolderNames', true)}{pick('Layout inside folders', 'viewMode', folderViews)}
      <details><summary>More appearance options</summary><div className="home-detail-fields">
        {flag('Show All tab', 'showAllTab', true)}{flag('Focus glow', 'focusGlowEnabled', true)}{flag('Show focused folder name', 'showFocusedFolderName', true)}
        <Field label="Excluded genre IDs" value={Array.isArray(value.excludedGenreIDs) ? value.excludedGenreIDs.join(', ') : ''}
          set={text => { if (/^[\d, ]*$/.test(text)) update('excludedGenreIDs', text.split(/[, ]+/).filter(Boolean).map(Number).filter(id => id > 0)); }} />
      </div></details>
    </>}
    {node.folder && <>{<Field label="Cover URL" value={value.coverImageUrl ?? value.cover_image_url} maxLength={8192} set={text => { update('coverImageUrl', text); if (!text) update('cover_image_url', undefined); }} />}{pick('Card shape', 'tileShape', tileShapes)}
      {flag('Hide folder title in Luma', 'hideTitle')}
      <details><summary>More appearance options</summary><div className="home-detail-fields">
        {pick('Subfolder shape', 'subfolderTileShape', tileShapes)}{pick('Layout inside folder', 'viewMode', folderViews)}
        {field('Presentation style', 'presentationStyle')}{field('Hero backdrop URL', 'heroBackdropUrl', 8192)}{field('Title logo URL', 'titleLogoUrl', 8192)}
        {field('Animated cover URL', 'focusVideoUrl', 8192)}{field('GIF cover URL', 'focusGifUrl', 8192)}{field('Hero video URL', 'heroVideoUrl', 8192)}
        {flag('Enable cover animation', 'focusGifEnabled')}{flag('Use first catalog artwork as cover', 'useFirstCatalogArtworkAsCover')}
        {Boolean(value.focusVideoUrl) && <AnimationPreview src={value.focusVideoUrl} />}
      </div></details>
      <details><summary>Folder destination</summary><div className="home-detail-fields">
        {pick('Open as', 'openTarget', [['', 'Folder'], ['catalog', 'Catalogs and folder page'], ['tmdb_person', 'TMDB person page']])}
        {value.openTarget === 'tmdb_person' && <>{field('TMDB person ID', 'tmdbPersonId')}{field('Person name', 'tmdbPersonName')}
          {field('Person profile path', 'tmdbPersonProfilePath')}{field('Person department', 'tmdbPersonDepartment')}</>}
      </div></details>
    </>}
    {node.section && <>{pick('Folder card shape', 'tileShape', tileShapes)}{flag('Hide row title in Luma', 'hideTitle')}</>}
    {node.source && <LumaCatalogEditor folder={sourceFolder} onChange={setSourceFolder} sourceId={`catalog:${node.source.id ?? 'source-0'}`} single />}
    {node.kind === 'widget' && <>
      <SyncCatalogPicker label="Change catalog" onSelect={item => update('source', { ...route, addonID: item.addonID, mediaType: item.mediaType, catalogID: item.catalogID })} />
      <Toggle label="Ranking numbers" checked={widget?.showRanking === true} set={v => setWidget('showRanking', v)} />
      <Choice label="Presentation" value={widget?.presentation} values={[[ '', 'Catalog row'], ['hero', 'Hero']]} set={v => setWidget('presentation', v || undefined)} />
      <details><summary>Catalog details and filters</summary><div className="home-detail-fields">
        <Field label="Manifest ID" value={route?.addonID} set={text => putSource('addonID', text.trim())} />
        <Field label="Media type" value={route?.mediaType} set={text => putSource('mediaType', text.trim())} />
        <Field label="Catalog ID" value={route?.catalogID} set={text => putSource('catalogID', text.trim())} />
        <Field label="Genre" value={widget?.genre} set={text => setWidget('genre', text || undefined)} />
        <Field label="Query" value={widget?.query} set={text => setWidget('query', text || undefined)} />
        <Choice label="Media filter" value={widget?.mediaType} values={[[ '', 'Default'], ['all', 'All'], ['movie', 'Movies'], ['series', 'Series']]} set={v => setWidget('mediaType', v || undefined)} />
      </div></details>
    </>}
    <Button type="button" disabled={disabled} onClick={() => save(node.source ? sourceFolder.sources![0] : value)}>Apply changes</Button>
  </>;
}
function MoveItem({ node, index, submit }: {
  node: HomeNode; index: Map<string, { node: HomeNode; parents: HomeNode[] }>; submit: (destination?: HomeNode) => void;
}) {
  const options: [string, string][] = canMoveHome(node) ? [['root', 'Home']] : [];
  for (const { node: target, parents } of index.values()) {
    if (canMoveHome(node, target)) options.push([target.key, ['Home', ...parents.map(item => item.title), target.title].join(' › ')]);
  }
  const [selected, setSelected] = useState(options[0]?.[0] ?? '');
  return options.length ? <>
    <Choice label="Destination" value={selected} values={options} set={setSelected} />
    <p className="sync-meta">Only destinations that can keep this item’s settings are listed.</p>
    <Button type="button" onClick={() => submit(index.get(selected)?.node)}>Move item</Button>
  </> : <p className="sync-empty">No compatible destination. The folder depth or catalog settings prevent moving this item.</p>;
}
