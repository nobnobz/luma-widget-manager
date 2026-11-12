'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';

const MoveByKey = createContext<(id: string, label: string, offset: number) => void>(() => undefined);
export function SortableRows({ ids, reorder, children, grid = false }: { ids: string[]; grid?: boolean; reorder: (from: number, to: number) => void; children: ReactNode }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [announcement, setAnnouncement] = useState('');
  return <DndContext sensors={sensors} collisionDetection={closestCenter}
    accessibility={{ screenReaderInstructions: { draggable: 'Use the Up and Down arrows to move a row.' } }}
    onDragEnd={({ active, over }) => {
      const from = ids.indexOf(String(active.id)), to = over ? ids.indexOf(String(over.id)) : -1;
      if (from >= 0 && to >= 0 && from !== to) reorder(from, to);
    }}><SortableContext items={ids} strategy={grid ? rectSortingStrategy : verticalListSortingStrategy}>
      <MoveByKey.Provider value={(id, label, offset) => {
        const from = ids.indexOf(id), to = from + offset;
        if (from < 0 || to < 0 || to >= ids.length) return;
        reorder(from, to); setAnnouncement(`${label}, position ${to + 1} of ${ids.length}.`);
      }}>{children}</MoveByKey.Provider>
      <span className="sr-only" role="status">{announcement}</span>
    </SortableContext></DndContext>;
}
export function SortableRow({ id, label, children }: { id: string; label: string; children: ReactNode | ((handle: ReactNode) => ReactNode) }) {
  const moveByKey = useContext(MoveByKey);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const embedded = typeof children === 'function';
  const handle = <Button ref={setActivatorNodeRef} type="button" variant="ghost" size="icon" className="sync-drag" {...attributes} {...listeners} aria-label={`Reorder ${label}`}
      aria-keyshortcuts="ArrowUp ArrowDown" title="Drag or use arrow keys" onKeyDown={event => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        moveByKey(id, label, event.key === 'ArrowUp' ? -1 : 1);
      }}><GripVertical /></Button>;
  return <div ref={setNodeRef} className={`sync-sort-row${embedded ? ' sync-sort-embedded' : ''}${isDragging ? ' is-dragging' : ''}`} style={{ transform: CSS.Translate.toString(transform), transition }}>
    {embedded ? children(handle) : <>{handle}<div className="min-w-0">{children}</div></>}
  </div>;
}
