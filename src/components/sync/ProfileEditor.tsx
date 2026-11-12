'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { ProfileEdit, SyncProfile } from '@/lib/luma-sync/documents';
import { avatarGroups, displayProfileName, editedProfileAvatar, editedProfileName, isBuiltInAvatar, profileFieldError } from '@/lib/luma-sync/profiles';

type Template = { profile: SyncProfile; count: number };
export function ProfileEditor({ profile, templates, preferred, saving, stale, serverError, close, restoreFocus, submit }: {
  profile?: SyncProfile; templates: Template[]; preferred: string; saving: boolean; stale: boolean; serverError: string;
  close: () => void; restoreFocus: () => void; submit: (value: ProfileEdit) => void;
}) {
  const formID = useId();
  const [name, setName] = useState(profile?.name ?? '');
  const originalAvatar = profile?.avatar ?? '';
  const [avatar, setAvatar] = useState(!originalAvatar || isBuiltInAvatar(originalAvatar) ? originalAvatar : 'existing');
  const [address, setAddress] = useState('');
  const [template, setTemplate] = useState(templates.some(item => item.profile.id === preferred) ? preferred : '');
  const [inherits, setInherits] = useState(profile?.inheritsAddons ?? false);
  const [error, setError] = useState('');
  const count = templates.find(item => item.profile.id === template)?.count ?? 0;
  const update = () => setError('');
  return <DialogContent className="sync-confirm" onCloseAutoFocus={event => { event.preventDefault(); requestAnimationFrame(restoreFocus); }}>
    <DialogTitle>{profile ? 'Edit profile' : 'Create profile'}</DialogTitle>
    <DialogDescription>{profile ? 'Update this profile on your synced Luma devices.' : 'Start fresh or copy the public add-ons from another profile.'}</DialogDescription>
    <form onSubmit={event => {
      event.preventDefault();
      if (saving || stale) return;
      try {
        const value = { name: editedProfileName(name, profile?.name),
          avatar: editedProfileAvatar(avatar === 'existing' ? originalAvatar : avatar === 'custom' ? address : avatar, profile?.avatar) };
        setError('');
        submit(profile ? { ...value, id: profile.id, inheritsAddons: inherits } : { ...value, copyPublicFrom: template || undefined });
      } catch (failure) { setError(profileFieldError(failure) ?? 'Check the profile details and try again.'); }
    }}>
      <fieldset disabled={saving} className="grid gap-3">
        <label className="sync-profile">Profile name<Input value={name} onChange={event => { setName(event.target.value); update(); }} autoFocus autoComplete="off" /></label>
        <div className="sync-profile"><label htmlFor={`${formID}-avatar`}>Avatar</label><select id={`${formID}-avatar`} value={avatar} onChange={event => { setAvatar(event.target.value); update(); }}>
          <option value="">Default avatar</option>
          {originalAvatar && !isBuiltInAvatar(originalAvatar) && <option value="existing">Keep current avatar</option>}
          {avatarGroups.map(group => <optgroup key={group.label} label={group.label}>{group.entries.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</optgroup>)}
          <option value="custom">Use an image address</option>
        </select></div>
        {avatar === 'custom' && <label className="sync-profile">HTTPS image address<Input required value={address}
          onChange={event => { setAddress(event.target.value); update(); }} placeholder="https://" maxLength={2048} inputMode="url" spellCheck={false} /></label>}
        {!profile && <>
          <div className="sync-profile"><label htmlFor={`${formID}-template`}>Copy public add-ons from</label><select id={`${formID}-template`} value={template} onChange={event => { setTemplate(event.target.value); update(); }}>
            <option value="">No template</option>
            {templates.map(({ profile, count }) => <option key={profile.id} value={profile.id}>{displayProfileName(profile)} ({count})</option>)}
          </select></div>
          <p className="sync-setting-note">{count > 0 && `Copies ${count} public add-on${count === 1 ? '' : 's'} into an independent list. `}
            To copy Jellyfin or SMB addresses, create the profile in Luma.</p>
        </>}
        {profile && Number(profile.id) !== 1 && <>
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={inherits}
            onChange={event => { setInherits(event.target.checked); update(); }} />Use shared add-ons</label>
          <p className="sync-setting-note">Use the primary profile’s add-ons. Turn this off to return to this profile’s own list.</p>
        </>}
      </fieldset>
      {(error || serverError) && <p className="sync-banner sync-error mt-3" role="alert">{error || serverError}</p>}
      <div className="sync-confirm-actions mt-4">
        <Button type="button" variant="outline" disabled={saving} onClick={close}>Cancel</Button>
        <Button type="submit" disabled={saving || stale}>{saving ? 'Saving…' : profile ? 'Save profile' : 'Create profile'}</Button>
      </div>
    </form>
  </DialogContent>;
}
