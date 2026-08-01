"use client";
import { useState, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { motion } from 'framer-motion';
import { Summary, SummaryResponse } from '@/types';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import Analytics from '@/lib/analytics';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { TranscriptPanel } from '@/components/MeetingDetails/TranscriptPanel';
import { SummaryPanel } from '@/components/MeetingDetails/SummaryPanel';
import { ModelConfig } from '@/components/ModelSettingsModal';

// Custom hooks
import { useMeetingData } from '@/hooks/meeting-details/useMeetingData';
import { useSummaryGeneration } from '@/hooks/meeting-details/useSummaryGeneration';
import { useTemplates } from '@/hooks/meeting-details/useTemplates';
import { useCopyOperations } from '@/hooks/meeting-details/useCopyOperations';
import { useMeetingOperations } from '@/hooks/meeting-details/useMeetingOperations';
import { useConfig } from '@/contexts/ConfigContext';

const DEFAULT_PANEL_SPLIT = 1 / 3;
const MIN_PANEL_WIDTH = 320;
const PANEL_SPLIT_STORAGE_KEY = 'meeting_panel_split';

export default function PageContent({
  meeting,
  summaryData,
  shouldAutoGenerate = false,
  onAutoGenerateComplete,
  onMeetingUpdated,
  onRefetchTranscripts,
  // Pagination props for efficient transcript loading
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
}: {
  meeting: any;
  summaryData: Summary | null;
  shouldAutoGenerate?: boolean;
  onAutoGenerateComplete?: () => void;
  onMeetingUpdated?: () => Promise<void>;
  onRefetchTranscripts?: () => Promise<void>;
  // Pagination props
  segments?: any[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;
}) {
  console.log('📄 PAGE CONTENT: Initializing with data:', {
    meetingId: meeting.id,
    summaryDataKeys: summaryData ? Object.keys(summaryData) : null,
    transcriptsCount: meeting.transcripts?.length
  });

  // State
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [isRecording] = useState(false);
  const [summaryResponse] = useState<SummaryResponse | null>(null);

  // Ref to store the modal open function from SummaryGeneratorButtonGroup
  const openModelSettingsRef = useRef<(() => void) | null>(null);
  const panelContainerRef = useRef<HTMLDivElement>(null);
  const panelResizeFrameRef = useRef<number | null>(null);
  const panelResizeOffsetRef = useRef(0);
  const [panelSplit, setPanelSplit] = useState(DEFAULT_PANEL_SPLIT);
  const [isResizingPanels, setIsResizingPanels] = useState(false);

  // Sidebar context
  const { serverAddress } = useSidebar();

  // Get model config from ConfigContext
  const { modelConfig, setModelConfig } = useConfig();

  // Custom hooks
  const meetingData = useMeetingData({ meeting, summaryData, onMeetingUpdated });
  const templates = useTemplates();

  // Callback to register the modal open function
  const handleRegisterModalOpen = (openFn: () => void) => {
    console.log('📝 Registering modal open function in PageContent');
    openModelSettingsRef.current = openFn;
  };

  // Callback to trigger modal open (called from error handler)
  const handleOpenModelSettings = () => {
    console.log('🔔 Opening model settings from PageContent');
    if (openModelSettingsRef.current) {
      openModelSettingsRef.current();
    } else {
      console.warn('⚠️ Modal open function not yet registered');
    }
  };

  // Save model config to backend database and sync via event
  const handleSaveModelConfig = async (config?: ModelConfig) => {
    if (!config) return;
    try {
      await invoke('api_save_model_config', {
        provider: config.provider,
        model: config.model,
        whisperModel: config.whisperModel,
        apiKey: config.apiKey ?? null,
        ollamaEndpoint: config.ollamaEndpoint ?? null,
      });

      // Emit event so ConfigContext and other listeners stay in sync
      const { emit } = await import('@tauri-apps/api/event');
      await emit('model-config-updated', config);

      toast.success('Model settings saved successfully');
    } catch (error) {
      console.error('Failed to save model config:', error);
      toast.error('Failed to save model settings');
    }
  };

  const summaryGeneration = useSummaryGeneration({
    meeting,
    transcripts: meetingData.transcripts,
    modelConfig: modelConfig,
    isModelConfigLoading: false, // ConfigContext loads on mount
    selectedTemplate: templates.selectedTemplate,
    onMeetingUpdated,
    updateMeetingTitle: meetingData.updateMeetingTitle,
    setAiSummary: meetingData.setAiSummary,
    onOpenModelSettings: handleOpenModelSettings,
  });

  const copyOperations = useCopyOperations({
    meeting,
    transcripts: meetingData.transcripts,
    meetingTitle: meetingData.meetingTitle,
    aiSummary: meetingData.aiSummary,
    blockNoteSummaryRef: meetingData.blockNoteSummaryRef,
  });

  const meetingOperations = useMeetingOperations({
    meeting,
  });

  // Track page view and restore the user's panel split.
  useEffect(() => {
    Analytics.trackPageView('meeting_details');

    const savedSplit = Number.parseFloat(localStorage.getItem(PANEL_SPLIT_STORAGE_KEY) ?? '');
    if (Number.isFinite(savedSplit) && savedSplit > 0 && savedSplit < 1) {
      setPanelSplit(savedSplit);
    }
  }, []);

  useEffect(() => () => {
    if (panelResizeFrameRef.current !== null) {
      cancelAnimationFrame(panelResizeFrameRef.current);
    }
    document.body.style.userSelect = '';
  }, []);

  const clampPanelSplit = (clientX: number) => {
    const bounds = panelContainerRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width < MIN_PANEL_WIDTH * 2) return panelSplit;

    const minimumSplit = MIN_PANEL_WIDTH / bounds.width;
    return Math.min(1 - minimumSplit, Math.max(minimumSplit, (clientX - bounds.left) / bounds.width));
  };

  const handlePanelResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    // Keep the grab point fixed relative to the divider: the hit pad is wider than the divider.
    const bounds = panelContainerRef.current?.getBoundingClientRect();
    panelResizeOffsetRef.current = bounds ? event.clientX - (bounds.left + panelSplit * bounds.width) : 0;
    document.body.style.userSelect = 'none';
    setIsResizingPanels(true);
  };

  const handlePanelResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isResizingPanels) return;
    const nextSplit = clampPanelSplit(event.clientX - panelResizeOffsetRef.current);

    if (panelResizeFrameRef.current !== null) cancelAnimationFrame(panelResizeFrameRef.current);
    panelResizeFrameRef.current = requestAnimationFrame(() => {
      setPanelSplit(nextSplit);
      panelResizeFrameRef.current = null;
    });
  };

  const handlePanelResizeEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isResizingPanels) return;
    if (panelResizeFrameRef.current !== null) {
      cancelAnimationFrame(panelResizeFrameRef.current);
      panelResizeFrameRef.current = null;
    }
    const finalSplit = clampPanelSplit(event.clientX - panelResizeOffsetRef.current);
    event.currentTarget.releasePointerCapture(event.pointerId);
    document.body.style.userSelect = '';
    setPanelSplit(finalSplit);
    setIsResizingPanels(false);
    localStorage.setItem(PANEL_SPLIT_STORAGE_KEY, String(finalSplit));
  };

  const resetPanelSplit = () => {
    setPanelSplit(DEFAULT_PANEL_SPLIT);
    localStorage.setItem(PANEL_SPLIT_STORAGE_KEY, String(DEFAULT_PANEL_SPLIT));
  };

  // Auto-generate summary when flag is set
  useEffect(() => {
    let cancelled = false;

    const autoGenerate = async () => {
      if (shouldAutoGenerate && meetingData.transcripts.length > 0 && !cancelled) {
        console.log(`🤖 Auto-generating summary with ${modelConfig.provider}/${modelConfig.model}...`);
        await summaryGeneration.handleGenerateSummary('');

        // Notify parent that auto-generation is complete (only if not cancelled)
        if (onAutoGenerateComplete && !cancelled) {
          onAutoGenerateComplete();
        }
      }
    };

    autoGenerate();

    // Cleanup: cancel if component unmounts or meeting changes
    return () => {
      cancelled = true;
    };
  }, [shouldAutoGenerate, meeting.id]); // Re-run if meeting changes

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex flex-col h-screen bg-muted/40"
    >
      <div ref={panelContainerRef} className="flex flex-1 min-w-0 overflow-hidden">
        <TranscriptPanel
          transcripts={meetingData.transcripts}
          customPrompt={customPrompt}
          onPromptChange={setCustomPrompt}
          onCopyTranscript={copyOperations.handleCopyTranscript}
          onOpenMeetingFolder={meetingOperations.handleOpenMeetingFolder}
          isRecording={isRecording}
          disableAutoScroll={true}
          // Pagination props for efficient loading
          usePagination={true}
          segments={segments}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          totalCount={totalCount}
          loadedCount={loadedCount}
          onLoadMore={onLoadMore}
          // Retranscription props
          meetingId={meeting.id}
          meetingFolderPath={meeting.folder_path}
          onRefetchTranscripts={onRefetchTranscripts}
          style={{ width: `${panelSplit * 100}%`, minWidth: MIN_PANEL_WIDTH }}
        />
        <div
          role="separator"
          aria-label="Resize transcript and summary panels"
          aria-orientation="vertical"
          aria-valuenow={Math.round(panelSplit * 100)}
          onDoubleClick={resetPanelSplit}
          onPointerDown={handlePanelResizeStart}
          onPointerMove={handlePanelResizeMove}
          onPointerUp={handlePanelResizeEnd}
          onPointerCancel={handlePanelResizeEnd}
          className={`relative z-10 hidden w-px shrink-0 cursor-col-resize touch-none md:block ${isResizingPanels ? 'bg-accent' : 'bg-border hover:bg-accent'}`}
        >
          <div className="absolute inset-y-0 -left-2 -right-2" />
        </div>
        <div className="flex flex-1 overflow-hidden" style={{ minWidth: MIN_PANEL_WIDTH }}>
        <SummaryPanel
          meeting={meeting}
          meetingTitle={meetingData.meetingTitle}
          onTitleChange={meetingData.handleTitleChange}
          isEditingTitle={meetingData.isEditingTitle}
          onStartEditTitle={() => meetingData.setIsEditingTitle(true)}
          onFinishEditTitle={() => meetingData.setIsEditingTitle(false)}
          isTitleDirty={meetingData.isTitleDirty}
          summaryRef={meetingData.blockNoteSummaryRef}
          isSaving={meetingData.isSaving}
          onSaveAll={meetingData.saveAllChanges}
          onCopySummary={copyOperations.handleCopySummary}
          onOpenFolder={meetingOperations.handleOpenMeetingFolder}
          aiSummary={meetingData.aiSummary}
          summaryStatus={summaryGeneration.summaryStatus}
          transcripts={meetingData.transcripts}
          modelConfig={modelConfig}
          setModelConfig={setModelConfig}
          onSaveModelConfig={handleSaveModelConfig}
          onGenerateSummary={summaryGeneration.handleGenerateSummary}
          onStopGeneration={summaryGeneration.handleStopGeneration}
          customPrompt={customPrompt}
          summaryResponse={summaryResponse}
          onSaveSummary={meetingData.handleSaveSummary}
          onSummaryChange={meetingData.handleSummaryChange}
          onDirtyChange={meetingData.setIsSummaryDirty}
          summaryError={summaryGeneration.summaryError}
          onRegenerateSummary={summaryGeneration.handleRegenerateSummary}
          getSummaryStatusMessage={summaryGeneration.getSummaryStatusMessage}
          availableTemplates={templates.availableTemplates}
          selectedTemplate={templates.selectedTemplate}
          onTemplateSelect={templates.handleTemplateSelection}
          isModelConfigLoading={false}
          onOpenModelSettings={handleRegisterModalOpen}
        />
        </div>
      </div>
    </motion.div>
  );
}
