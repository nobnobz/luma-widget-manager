import type { Metadata } from 'next';
import '../sync.css';

export const metadata: Metadata = { title: 'Luma Sync · Privacy & credits', referrer: 'no-referrer' };

export default function PrivacyPage() {
  const syncPath = (process.env.NEXT_PUBLIC_BASE_PATH || '') + '/sync/';
  return <>
    {/* eslint-disable-next-line @next/next/no-css-tags */}
    <link rel="stylesheet" href="/assets/theme.css" precedence="luma-sync" />
    <div className="sync-web">
      <main className="sync-privacy">
        <a className="sync-text-link" href={syncPath}>← Luma Sync</a>
        <header>
          <p className="sync-setting-hint">Luma Sync</p>
          <h1>Privacy & credits</h1>
          <nav aria-label="Language"><a className="sync-text-link" href="#en">English</a><a className="sync-text-link" href="#de" lang="de">Deutsch</a></nav>
        </header>
        <section id="en" lang="en" className="sync-panel" aria-labelledby="privacy-en">
          <h2 id="privacy-en">What Luma Sync stores</h2>
          <p>Luma Sync uses a passkey to sign you in. Your devices encrypt your profiles, settings and supported library data before sending them to the server. The server also keeps the account and device records needed to run sync.</p>
          <h3>Connected tracking accounts</h3>
          <p>Connecting Trakt, Simkl or MDBList is optional. The Sync server keeps your account name and identifier and a separate encrypted OAuth authorization while the account is connected. The server can use that authorization to send requests you enable, such as reading your watchlist or reporting media identifiers and playback progress. You sign in at the provider; Luma does not receive your provider password.</p>
          <h3>Disconnect or delete</h3>
          <p>Disconnect an account under Tracking in the web portal or Connected Accounts in Luma. This removes the authorization from the live Sync server. You can also revoke Luma in the provider’s settings. Disconnecting keeps your existing watch history and entries already copied to Luma. Deleting the Sync space in the app removes its records from the live server. The server operator manages encrypted backups separately.</p>
          <p className="sync-setting-note" id="trakt">Luma uses Trakt but is not endorsed or certified by Trakt.</p>
        </section>
        <section id="de" lang="de" className="sync-panel" aria-labelledby="privacy-de">
          <h2 id="privacy-de">Was Luma Sync speichert</h2>
          <p>Du meldest dich bei Luma Sync mit einem Passkey an. Deine Geräte verschlüsseln Profile, Einstellungen und unterstützte Bibliotheksdaten, bevor sie sie an den Server senden. Der Server speichert außerdem die für den Abgleich nötigen Konto- und Geräteinformationen.</p>
          <h3>Verbundene Tracking-Konten</h3>
          <p>Trakt, Simkl und MDBList sind optional. Solange das Konto verbunden ist, speichert der Sync-Server Kontoname und Kennung sowie eine separat verschlüsselte OAuth-Freigabe. Damit kann der Server die von dir erlaubten Anfragen ausführen, etwa die Merkliste abrufen oder Medienkennungen und Wiedergabefortschritt melden. Du meldest dich beim Anbieter an; Luma erhält dein Anbieterpasswort nicht.</p>
          <h3>Trennen oder löschen</h3>
          <p>Trenne ein Konto unter Tracking im Webportal oder unter Verbundene Konten in Luma. Damit wird die Freigabe vom laufenden Sync-Server entfernt. Du kannst Luma auch in den Einstellungen des Anbieters widerrufen. Der bisherige Verlauf und bereits nach Luma übernommene Einträge bleiben erhalten. Wenn du den Sync-Bereich in der App löschst, werden seine Daten vom laufenden Server entfernt. Verschlüsselte Sicherungen verwaltet der Serverbetreiber separat.</p>
          <p className="sync-setting-note">Luma verwendet Trakt, wird aber von Trakt weder unterstützt noch zertifiziert.</p>
        </section>
      </main>
    </div>
  </>;
}
