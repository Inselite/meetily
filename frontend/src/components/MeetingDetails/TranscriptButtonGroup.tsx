"use client";

import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Check, Copy, FolderOpen, Loader2, RefreshCw, Users } from 'lucide-react';
import Analytics from '@/lib/analytics';
import { RetranscribeDialog } from './RetranscribeDialog';
import { useConfig } from '@/contexts/ConfigContext';

const SPEAKER_COUNT_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8];
// The external sweep runs every ~3 minutes; poll a little faster than that
// and give up well after several cycles have had their chance.
const DIARIZE_POLL_MS = 10_000;
const DIARIZE_POLL_TIMEOUT_MS = 15 * 60_000;

interface DiarizeStatus {
  done: boolean;
  diarized_at: number | null; // unix seconds of transcript_diarized.md
  speakers: number | null;
}

interface TranscriptButtonGroupProps {
  transcriptCount: number;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  meetingId?: string;
  meetingFolderPath?: string | null;
  onRefetchTranscripts?: () => Promise<void>;
}


export function TranscriptButtonGroup({
  transcriptCount,
  onCopyTranscript,
  onOpenMeetingFolder,
  meetingId,
  meetingFolderPath,
  onRefetchTranscripts,
}: TranscriptButtonGroupProps) {
  const { betaFeatures } = useConfig();
  const [showRetranscribeDialog, setShowRetranscribeDialog] = useState(false);
  const [settingSpeakers, setSettingSpeakers] = useState(false);
  const [diarizing, setDiarizing] = useState(false);
  const [configuredSpeakers, setConfiguredSpeakers] = useState<number | null>(null);
  const settingSpeakersRef = useRef(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    setDiarizing(false);
  }, []);

  // New meeting selected: drop any in-flight poll and refresh the check mark.
  useEffect(() => {
    stopPolling();
    setConfiguredSpeakers(null);
    if (!meetingId || !meetingFolderPath) return;
    invoke<DiarizeStatus>('api_get_diarize_status', { meetingId })
      .then((status) => setConfiguredSpeakers(status.speakers))
      .catch(() => {});
    return stopPolling;
  }, [meetingId, meetingFolderPath, stopPolling]);

  const startPolling = useCallback((startedAt: number) => {
    if (!meetingId) return;
    setDiarizing(true);
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(async () => {
      try {
        const status = await invoke<DiarizeStatus>('api_get_diarize_status', { meetingId });
        // After a Retranscribe the stale labeled transcript still exists until
        // the sweep wipes it — only a file (re)written after we started counts.
        const freshDone =
          status.done &&
          (status.diarized_at === null || status.diarized_at * 1000 >= startedAt - 5000);
        if (freshDone) {
          stopPolling();
          toast.success('Speaker labels updated', {
            description: 'The transcript now shows the re-diarized speakers.',
          });
          await onRefetchTranscripts?.();
          return;
        }
      } catch {
        // transient — keep polling until the timeout
      }
      if (Date.now() - startedAt > DIARIZE_POLL_TIMEOUT_MS) {
        stopPolling();
        toast.info('Re-diarization is taking longer than expected', {
          description: 'Check the sweep log, or reopen the meeting later.',
        });
      }
    }, DIARIZE_POLL_MS);
  }, [meetingId, onRefetchTranscripts, stopPolling]);

  const handleSetSpeakerCount = useCallback(async (speakers: number | null) => {
    if (!meetingId || settingSpeakersRef.current) return;
    Analytics.trackButtonClick('set_diarize_speakers', 'meeting_details');
    settingSpeakersRef.current = true;
    setSettingSpeakers(true);
    try {
      await invoke('api_set_diarize_speakers', { meetingId, speakers });
      setConfiguredSpeakers(speakers);
      toast.success(
        speakers === null
          ? 'Speaker count reset to automatic — re-diarization queued'
          : `Re-diarization queued with ${speakers} speaker${speakers === 1 ? '' : 's'}`,
        { description: 'Labels update within a few minutes.' },
      );
      startPolling(Date.now());
    } catch (error) {
      toast.error(`Could not queue re-diarization: ${error}`);
    } finally {
      settingSpeakersRef.current = false;
      setSettingSpeakers(false);
    }
  }, [meetingId, startPolling]);

  const handleRetranscribeComplete = useCallback(async () => {
    // Refetch transcripts to show the updated data
    if (onRefetchTranscripts) {
      await onRefetchTranscripts();
    }
    // The sweep detects the replaced transcript rows and re-labels speakers
    // a few minutes later — keep the indicator alive until that lands too.
    startPolling(Date.now());
  }, [onRefetchTranscripts, startPolling]);

  const speakerChoiceItem = (label: string, value: number | null) => (
    <DropdownMenuItem
      key={label}
      className="flex items-center justify-between gap-2"
      onSelect={() => handleSetSpeakerCount(value)}
    >
      {label}
      {configuredSpeakers === value && <Check className="h-4 w-4 text-success-text" />}
    </DropdownMenuItem>
  );

  return (
    <div className="flex items-center justify-start w-full gap-2">
      <ButtonGroup>
        <Button
          variant="outline"
          size="sm"
          className="xl:px-4"
          onClick={() => {
            Analytics.trackButtonClick('copy_transcript', 'meeting_details');
            onCopyTranscript();
          }}
          disabled={transcriptCount === 0}
          title={transcriptCount === 0 ? 'No transcript available' : 'Copy Transcript'}
        >
          <Copy />
          <span className="hidden lg:inline">Copy</span>
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="xl:px-4"
          onClick={() => {
            Analytics.trackButtonClick('open_recording_folder', 'meeting_details');
            onOpenMeetingFolder();
          }}
          title="Open Recording Folder"
        >
          <FolderOpen />
          <span className="hidden lg:inline">Recording</span>
        </Button>

        {meetingId && meetingFolderPath && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="xl:px-4"
                disabled={settingSpeakers}
                title={
                  diarizing
                    ? 'Re-diarization in progress'
                    : 'Set how many speakers the diarizer should find'
                }
              >
                {diarizing ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Users />
                )}
                <span className="hidden lg:inline">
                  {diarizing ? 'Relabeling…' : 'Speakers'}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Speakers in this meeting</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {speakerChoiceItem('Auto-detect', null)}
              {SPEAKER_COUNT_CHOICES.map((count) =>
                speakerChoiceItem(`${count} ${count === 1 ? 'speaker' : 'speakers'}`, count),
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {betaFeatures.importAndRetranscribe && meetingId && meetingFolderPath && (
          <Button
            size="sm"
            variant="outline"
            className="bg-gradient-to-r from-info/10 to-info/20 hover:from-info/10 hover:to-info/20 border-info/30 xl:px-4"
            onClick={() => {
              Analytics.trackButtonClick('enhance_transcript', 'meeting_details');
              setShowRetranscribeDialog(true);
            }}
            title="Retranscribe to enhance your recorded audio"
          >
            <RefreshCw />
            <span className="hidden lg:inline">Enhance</span>
          </Button>
        )}
      </ButtonGroup>

      {betaFeatures.importAndRetranscribe && meetingId && meetingFolderPath && (
        <RetranscribeDialog
          open={showRetranscribeDialog}
          onOpenChange={setShowRetranscribeDialog}
          meetingId={meetingId}
          meetingFolderPath={meetingFolderPath}
          onComplete={handleRetranscribeComplete}
        />
      )}
    </div>
  );
}
