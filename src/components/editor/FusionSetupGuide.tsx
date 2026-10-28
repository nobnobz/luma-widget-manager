"use client";

import {
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  Download,
  ExternalLink,
  FileJson2,
  Globe,
  Import,
  Link2,
  MousePointer2,
  RefreshCcw,
  Sparkles,
} from "lucide-react";
import { useConfig } from '@/context/ConfigContext';
import { Button } from "@/components/ui/button";
import type { RepositoryTemplate } from "@/lib/template-repository";
import { formatTemplateLabel } from "@/lib/template-repository";
import {
  FusionGuideDialog,
  FusionGuideFlow,
  FusionGuidePanel,
  FusionGuideSection,
  FusionGuideStepList,
} from "./FusionGuidePrimitives";

type FusionSetupGuideProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  aiometadataTemplate?: RepositoryTemplate | null;
  isTemplateLoading?: boolean;
  onDownloadAiometadataTemplate?: () => void | Promise<void>;
};

const aiometadataInstances = [
  {
    label: "AIOMetadata Midnight",
    href: "https://aiometadatafortheweebs.midnightignite.me/configure/",
  },
  {
    label: "AIOMetadata Yeb",
    href: "https://aiometadata.fortheweak.cloud/configure/",
  },
] as const;

export function FusionSetupGuide({
  open,
  onOpenChange,
  aiometadataTemplate,
  isTemplateLoading = false,
  onDownloadAiometadataTemplate,
}: FusionSetupGuideProps) {
  const { isLuma } = useConfig();
  if (isLuma) return <FusionGuideDialog open={open} onOpenChange={onOpenChange} title="Luma Setup Guide" icon={BookOpen} description="The familiar widget workflow, extended with Luma hubs."><FusionGuideFlow title="Build your layout" items={[{ title: 'Load or create', detail: 'Import Luma/Fusion JSON, choose a UME template or add a Home row. Folder row shows folder cards; Catalog row shows posters directly.', icon: Import }, { title: 'Connect catalogs', detail: 'Sync your AIOMetadata manifest and select catalogs in folder cards.', icon: Link2 }, { title: 'Build hub pages', detail: 'Open a folder, then Edit hub page to add folder rows and subfolders. Add catalogs from the folder card.', icon: Sparkles }, { title: 'Export for Luma', detail: 'Choose Luma in Export JSON. Folder rows use Collection Backups on iOS or Collections on macOS. Catalog rows use Luma’s Fusion import. Download both files for a mixed layout.', icon: Download }]} /><div className="mx-2 grid gap-4 sm:mx-0 sm:grid-cols-2"><section className="rounded-2xl border border-border/60 p-5"><h3 className="font-bold">Animated covers</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Use the existing Animated Covers area to apply a pack to matching folders. Videos and background artwork are included in the Luma export, including nested folders. Custom videos are preserved. Focus-video playback is currently implemented on tvOS.</p></section><section className="rounded-2xl border border-border/60 p-5"><h3 className="font-bold">Stream badge packs</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Choose a variant in Stream Badge Packs and copy its URL. Import that URL in Luma’s Badge Packs settings. Tags have a separate importer and are not part of collection JSON.</p></section></div><p className="px-2 text-sm text-muted-foreground">Folders can nest to three levels. iOS and macOS render hub pages; the current tvOS browser still needs nested-page support. Empty hub layouts need real catalog sources before they show content. A hub is the page behind a folder. A Home folder row groups folder cards; a Home catalog row displays one catalog directly.</p></FusionGuideDialog>;
  const templateLabel = aiometadataTemplate
    ? formatTemplateLabel("UME AIOMetadata Template", aiometadataTemplate)
    : "UME AIOMetadata Template";

  return (
    <FusionGuideDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Fusion Setup Guide"
      icon={BookOpen}
    >
      <FusionGuideFlow
        title="Install Flow"
        items={[
          {
            title: "Load a setup",
            icon: Import,
          },
          {
            title: "Prepare AIOMetadata",
            icon: Link2,
          },
          {
            title: "Sync the manifest",
            icon: RefreshCcw,
          },
          {
            title: "Personalize and export",
            icon: Sparkles,
          },
        ]}
      />

      <FusionGuideSection
        step="01"
        title="Load a setup"
        icon={FileJson2}
      >
        <FusionGuideStepList
          items={[
            "Use the UME template if you want a ready-made starting point.",
            "Upload your current Fusion export or Omni snapshot if you want to continue from an existing setup.",
          ]}
        />
      </FusionGuideSection>

      <FusionGuideSection
        step="02"
        title="Export the required AIOMetadata catalogs"
        icon={Download}
      >
        <FusionGuideStepList
          items={[
            "Open Export -> AIOMetadata.",
            "Click on Copy All Catalogs.",
          ]}
        />
      </FusionGuideSection>

      <FusionGuideSection
        step="03"
        title="Add the catalogs to AIOMetadata"
        icon={Globe}
      >
        <div className="space-y-3">
          <FusionGuideStepList
            items={[
              "Open AIOMetadata and go to Catalogs -> Import from Setup.",
              "Paste the copied catalogs and import them.",
              "Go to Configuration, click Save Configuration, and copy the Manifest URL.",
            ]}
          />

          <div className="grid gap-3 grid-cols-1">
            <FusionGuidePanel title="Recommended AIOMetadata instances" icon={ExternalLink}>
              <div className="space-y-2.5">
                {aiometadataInstances.map((instance) => (
                  <a
                    key={instance.href}
                    href={instance.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center justify-between gap-3 rounded-2xl border border-primary/16 bg-primary/[0.05] px-3.5 py-3 transition-all hover:border-primary/28 hover:bg-primary/[0.08] dark:border-primary/20 dark:bg-primary/[0.08] dark:hover:bg-primary/[0.12]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold tracking-tight text-foreground">{instance.label}</p>
                      <p className="mt-1 truncate text-[12px] text-primary/88 sm:text-[13px]">{instance.href}</p>
                    </div>
                    <ArrowUpRight className="size-4 shrink-0 text-primary/78 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </a>
                ))}
              </div>
            </FusionGuidePanel>

            <FusionGuidePanel title="First-time setup" icon={CheckCircle2}>
              <p className="text-[14px] leading-6 text-foreground/76">
                Import the full UME AIOMetadata template for a fresh setup. Make sure your API keys (including MDBList) are configured correctly.
              </p>
              <div className="mt-3">
                {aiometadataTemplate ? (
                  <button
                    type="button"
                    onClick={() => {
                      void onDownloadAiometadataTemplate?.();
                    }}
                    className="group flex items-center justify-between gap-3 rounded-2xl border border-primary/16 bg-primary/[0.06] px-3.5 py-3 transition-all hover:border-primary/28 hover:bg-primary/[0.09] dark:border-primary/20 dark:bg-primary/[0.08] dark:hover:bg-primary/[0.12]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold tracking-tight text-foreground">{templateLabel}</p>
                    </div>
                    <Download className="size-4 shrink-0 text-primary/80 transition-transform group-hover:translate-y-0.5" />
                  </button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    disabled
                    className="h-auto w-full justify-start rounded-2xl border-border/55 bg-background/70 px-3.5 py-3 text-left"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold tracking-tight text-foreground/72">
                        {isTemplateLoading ? "Loading current AIOMetadata template..." : "Current AIOMetadata template unavailable"}
                      </p>
                    </div>
                  </Button>
                )}
              </div>
            </FusionGuidePanel>
          </div>
        </div>
      </FusionGuideSection>

      <FusionGuideSection
        step="04"
        title="Sync your manifest in Fusion Manager"
        icon={RefreshCcw}
      >
        <FusionGuideStepList
          items={[
            "Click Sync Manifest in Fusion Manager.",
            "Paste the AIOMetadata Manifest URL you copied from AIOMetadata.",
          ]}
        />
      </FusionGuideSection>

      <FusionGuideSection
        step="05"
        title="Personalize your setup (Optional)"
        icon={MousePointer2}
      >
        <FusionGuideStepList
          ordered={false}
          items={[
            "Edit widget titles and settings.",
            "Delete widgets or items you do not want to keep.",
            "Reorder widgets to match your preferred layout.",
            "Import widgets from other setups and merge or update them when needed.",
          ]}
        />
      </FusionGuideSection>

      <FusionGuideSection
        step="06"
        title="Export to Fusion"
        icon={Download}
      >
        <FusionGuideStepList
          items={[
            "Open Export -> Fusion and copy the generated JSON.",
            "Open Fusion and import it under Settings -> Widgets -> Import.",
          ]}
        />
      </FusionGuideSection>
    </FusionGuideDialog>
  );
}
