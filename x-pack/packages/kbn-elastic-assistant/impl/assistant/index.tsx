/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  EuiFlexGroup,
  EuiFlexItem,
  EuiSpacer,
  EuiButtonIcon,
  EuiHorizontalRule,
  EuiCommentList,
  EuiToolTip,
  EuiSwitchEvent,
  EuiSwitch,
  EuiModalFooter,
  EuiModalHeader,
  EuiModalBody,
} from '@elastic/eui';

import { createPortal } from 'react-dom';
import { css } from '@emotion/react';

import { OpenAiProviderType } from '@kbn/stack-connectors-plugin/common/gen_ai/constants';
import { ActionConnectorProps } from '@kbn/triggers-actions-ui-plugin/public/types';
import { WELCOME_CONVERSATION_TITLE } from './use_conversation/translations';
import { AssistantTitle } from './assistant_title';
import { UpgradeButtons } from '../upgrade/upgrade_buttons';
import { getDefaultConnector, getMessageFromRawResponse, getWelcomeConversation } from './helpers';

import { useAssistantContext } from '../assistant_context';
import { ContextPills } from './context_pills';
import { getNewSelectedPromptContext } from '../data_anonymization/get_new_selected_prompt_context';
import { PromptTextArea } from './prompt_textarea';
import type { PromptContext, SelectedPromptContext } from './prompt_context/types';
import { useConversation } from './use_conversation';
import { CodeBlockDetails, getDefaultSystemPrompt } from './use_conversation/helpers';
import { useSendMessages } from './use_send_messages';
import type { Message } from '../assistant_context/types';
import { ConversationSelector } from './conversations/conversation_selector';
import { PromptEditor } from './prompt_editor';
import { getCombinedMessage } from './prompt/helpers';
import * as i18n from './translations';
import { QuickPrompts } from './quick_prompts/quick_prompts';
import { useLoadConnectors } from '../connectorland/use_load_connectors';
import { useConnectorSetup } from '../connectorland/connector_setup';
import { AssistantSettingsButton } from './settings/assistant_settings_button';
import { ConnectorMissingCallout } from '../connectorland/connector_missing_callout';

export interface Props {
  conversationId?: string;
  isAssistantEnabled: boolean;
  promptContextId?: string;
  shouldRefocusPrompt?: boolean;
  showTitle?: boolean;
}

/**
 * Renders a chat window with a prompt input and a chat history, along with
 * quick prompts for common actions, settings, and prompt context providers.
 */
const AssistantComponent: React.FC<Props> = ({
  conversationId,
  isAssistantEnabled,
  promptContextId = '',
  shouldRefocusPrompt = false,
  showTitle = true,
}) => {
  const {
    actionTypeRegistry,
    augmentMessageCodeBlocks,
    conversations,
    defaultAllow,
    defaultAllowReplacement,
    docLinks,
    getComments,
    http,
    promptContexts,
    setLastConversationId,
    localStorageLastConversationId,
    title,
    allSystemPrompts,
  } = useAssistantContext();

  const [selectedPromptContexts, setSelectedPromptContexts] = useState<
    Record<string, SelectedPromptContext>
  >({});
  const selectedPromptContextsCount = useMemo(
    () => Object.keys(selectedPromptContexts).length,
    [selectedPromptContexts]
  );

  const { appendMessage, appendReplacements, clearConversation, createConversation } =
    useConversation();
  const { isLoading, sendMessages } = useSendMessages();

  // Connector details
  const {
    data: connectors,
    isSuccess: areConnectorsFetched,
    refetch: refetchConnectors,
  } = useLoadConnectors({ http });
  const defaultConnectorId = useMemo(() => getDefaultConnector(connectors)?.id, [connectors]);
  const defaultProvider = useMemo(
    () =>
      (
        getDefaultConnector(connectors) as ActionConnectorProps<
          { apiProvider: OpenAiProviderType },
          unknown
        >
      )?.config?.apiProvider,
    [connectors]
  );

  const [selectedConversationId, setSelectedConversationId] = useState<string>(
    isAssistantEnabled
      ? // if a conversationId has been provided, use that
        // if not, check local storage
        // last resort, go to welcome conversation
        conversationId ?? localStorageLastConversationId ?? WELCOME_CONVERSATION_TITLE
      : WELCOME_CONVERSATION_TITLE
  );

  const currentConversation = useMemo(
    () =>
      conversations[selectedConversationId] ??
      createConversation({ conversationId: selectedConversationId }),
    [conversations, createConversation, selectedConversationId]
  );

  // Welcome setup state
  const isWelcomeSetup = useMemo(() => {
    // if any conversation has a connector id, we're not in welcome set up
    return Object.keys(conversations).some(
      (conversation) => conversations[conversation].apiConfig.connectorId != null
    )
      ? false
      : (connectors?.length ?? 0) === 0;
  }, [connectors?.length, conversations]);
  const isDisabled = isWelcomeSetup || !isAssistantEnabled;

  // Welcome conversation is a special 'setup' case when no connector exists, mostly extracted to `ConnectorSetup` component,
  // but currently a bit of state is littered throughout the assistant component. TODO: clean up/isolate this state
  const welcomeConversation = useMemo(
    () => getWelcomeConversation(currentConversation, isAssistantEnabled),
    [currentConversation, isAssistantEnabled]
  );

  // Settings modal state (so it isn't shared between assistant instances like Timeline)
  const [isSettingsModalVisible, setIsSettingsModalVisible] = useState(false);

  // Remember last selection for reuse after keyboard shortcut is pressed.
  // Clear it if there is no connectors
  useEffect(() => {
    if (areConnectorsFetched && !connectors?.length) {
      return setLastConversationId(WELCOME_CONVERSATION_TITLE);
    }

    if (!currentConversation.excludeFromLastConversationStorage) {
      setLastConversationId(currentConversation.id);
    }
  }, [areConnectorsFetched, connectors?.length, currentConversation, setLastConversationId]);

  const { comments: connectorComments, prompt: connectorPrompt } = useConnectorSetup({
    actionTypeRegistry,
    http,
    refetchConnectors,
    onSetupComplete: () => {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    },
    conversation: welcomeConversation,
    isConnectorConfigured: !!connectors?.length,
  });

  const currentTitle: { title: string | JSX.Element; titleIcon: string } =
    isWelcomeSetup && welcomeConversation.theme?.title && welcomeConversation.theme?.titleIcon
      ? { title: welcomeConversation.theme?.title, titleIcon: welcomeConversation.theme?.titleIcon }
      : { title, titleIcon: 'logoSecurity' };

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastCommentRef = useRef<HTMLDivElement | null>(null);

  const [promptTextPreview, setPromptTextPreview] = useState<string>('');
  const [autoPopulatedOnce, setAutoPopulatedOnce] = useState<boolean>(false);
  const [userPrompt, setUserPrompt] = useState<string | null>(null);

  const [showMissingConnectorCallout, setShowMissingConnectorCallout] = useState<boolean>(false);

  const [showAnonymizedValues, setShowAnonymizedValues] = useState<boolean>(false);

  const [messageCodeBlocks, setMessageCodeBlocks] = useState<CodeBlockDetails[][]>();
  const [_, setCodeBlockControlsVisible] = useState(false);
  useLayoutEffect(() => {
    setMessageCodeBlocks(augmentMessageCodeBlocks(currentConversation));
  }, [augmentMessageCodeBlocks, currentConversation]);

  const isSendingDisabled = useMemo(() => {
    return isDisabled || showMissingConnectorCallout;
  }, [showMissingConnectorCallout, isDisabled]);

  // Fixes initial render not showing buttons as code block controls are added to the DOM really late
  useEffect(() => {
    const updateElements = () => {
      const elements = document.querySelectorAll('.euiCodeBlock__controls');
      setCodeBlockControlsVisible(elements.length > 0);
    };

    updateElements(); // Initial update

    const observer = new MutationObserver(updateElements);
    observer.observe(document.body, { subtree: true, childList: true });

    return () => {
      observer.disconnect(); // Clean up the observer if component unmounts
    };
  }, []);
  // End drill in `Add To Timeline` action

  // For auto-focusing prompt within timeline
  const promptTextAreaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (shouldRefocusPrompt && promptTextAreaRef.current) {
      promptTextAreaRef?.current.focus();
    }
  }, [shouldRefocusPrompt]);

  // Scroll to bottom on conversation change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, []);
  useEffect(() => {
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
      promptTextAreaRef?.current?.focus();
    }, 0);
  }, [currentConversation.messages.length, selectedPromptContextsCount]);
  ////
  //

  const selectedSystemPrompt = useMemo(
    () => getDefaultSystemPrompt({ allSystemPrompts, conversation: currentConversation }),
    [allSystemPrompts, currentConversation]
  );

  const [editingSystemPromptId, setEditingSystemPromptId] = useState<string | undefined>(
    selectedSystemPrompt?.id
  );

  const handleOnConversationSelected = useCallback(
    (cId: string) => {
      setSelectedConversationId(cId);
      setEditingSystemPromptId(
        getDefaultSystemPrompt({ allSystemPrompts, conversation: conversations[cId] })?.id
      );
    },
    [allSystemPrompts, conversations]
  );

  const handlePromptChange = useCallback((prompt: string) => {
    setPromptTextPreview(prompt);
    setUserPrompt(prompt);
  }, []);

  // Handles sending latest user prompt to API
  const handleSendMessage = useCallback(
    async (promptText) => {
      const onNewReplacements = (newReplacements: Record<string, string>) =>
        appendReplacements({
          conversationId: selectedConversationId,
          replacements: newReplacements,
        });

      const systemPrompt = allSystemPrompts.find((prompt) => prompt.id === editingSystemPromptId);

      const message = await getCombinedMessage({
        isNewChat: currentConversation.messages.length === 0,
        currentReplacements: currentConversation.replacements,
        onNewReplacements,
        promptText,
        selectedPromptContexts,
        selectedSystemPrompt: systemPrompt,
      });

      const updatedMessages = appendMessage({
        conversationId: selectedConversationId,
        message,
      });

      // Reset prompt context selection and preview before sending:
      setSelectedPromptContexts({});
      setPromptTextPreview('');

      const rawResponse = await sendMessages({
        http,
        apiConfig: currentConversation.apiConfig,
        messages: updatedMessages,
      });
      const responseMessage: Message = getMessageFromRawResponse(rawResponse);
      appendMessage({ conversationId: selectedConversationId, message: responseMessage });
    },
    [
      allSystemPrompts,
      currentConversation.messages.length,
      currentConversation.replacements,
      currentConversation.apiConfig,
      selectedPromptContexts,
      appendMessage,
      selectedConversationId,
      sendMessages,
      http,
      appendReplacements,
      editingSystemPromptId,
    ]
  );

  const handleButtonSendMessage = useCallback(() => {
    handleSendMessage(promptTextAreaRef.current?.value?.trim() ?? '');
    setUserPrompt('');
  }, [handleSendMessage, promptTextAreaRef]);

  const handleOnSystemPromptSelectionChange = useCallback((systemPromptId?: string) => {
    setEditingSystemPromptId(systemPromptId);
  }, []);

  const handleOnChatCleared = useCallback(() => {
    const defaultSystemPromptId = getDefaultSystemPrompt({
      allSystemPrompts,
      conversation: conversations[selectedConversationId],
    })?.id;

    setPromptTextPreview('');
    setUserPrompt('');
    setSelectedPromptContexts({});
    clearConversation(selectedConversationId);
    setEditingSystemPromptId(defaultSystemPromptId);
  }, [allSystemPrompts, clearConversation, conversations, selectedConversationId]);

  const shouldDisableConversationSelectorHotkeys = useCallback(() => {
    const promptTextAreaHasFocus = document.activeElement === promptTextAreaRef.current;
    return promptTextAreaHasFocus;
  }, [promptTextAreaRef]);

  // Add min-height to all codeblocks so timeline icon doesn't overflow
  const codeBlockContainers = [...document.getElementsByClassName('euiCodeBlock')];
  // @ts-ignore-expect-error
  codeBlockContainers.forEach((e) => (e.style.minHeight = '75px'));
  ////

  const onToggleShowAnonymizedValues = useCallback(
    (e: EuiSwitchEvent) => {
      if (setShowAnonymizedValues != null) {
        setShowAnonymizedValues(e.target.checked);
      }
    },
    [setShowAnonymizedValues]
  );

  useEffect(() => {
    // Adding `conversationId !== selectedConversationId` to prevent auto-run still executing after changing selected conversation
    if (currentConversation.messages.length || conversationId !== selectedConversationId) {
      return;
    }

    if (autoPopulatedOnce) {
      return;
    }

    const promptContext: PromptContext | undefined = promptContexts[promptContextId];
    if (promptContext != null) {
      setAutoPopulatedOnce(true);

      if (!Object.keys(selectedPromptContexts).includes(promptContext.id)) {
        const addNewSelectedPromptContext = async () => {
          const newSelectedPromptContext = await getNewSelectedPromptContext({
            defaultAllow,
            defaultAllowReplacement,
            promptContext,
          });

          setSelectedPromptContexts((prev) => ({
            ...prev,
            [promptContext.id]: newSelectedPromptContext,
          }));
        };

        addNewSelectedPromptContext();
      }

      if (promptContext.suggestedUserPrompt != null) {
        setUserPrompt(promptContext.suggestedUserPrompt);
      }
    }
  }, [
    currentConversation.messages,
    promptContexts,
    promptContextId,
    handleSendMessage,
    conversationId,
    selectedConversationId,
    selectedPromptContexts,
    autoPopulatedOnce,
    defaultAllow,
    defaultAllowReplacement,
  ]);

  // Show missing connector callout if no connectors are configured
  useEffect(() => {
    const connectorExists =
      connectors?.some(
        (connector) => connector.id === currentConversation.apiConfig?.connectorId
      ) ?? false;
    setShowMissingConnectorCallout(!connectorExists);
  }, [connectors, currentConversation]);

  const createCodeBlockPortals = useCallback(
    () =>
      messageCodeBlocks?.map((codeBlocks: CodeBlockDetails[]) => {
        return codeBlocks.map((codeBlock: CodeBlockDetails) => {
          const getElement = codeBlock.getControlContainer;
          const element = getElement?.();
          return element ? createPortal(codeBlock.button, element) : <></>;
        });
      }),
    [messageCodeBlocks]
  );

  const chatbotComments = useMemo(
    () => (
      <>
        <EuiCommentList
          comments={getComments({
            currentConversation,
            lastCommentRef,
            showAnonymizedValues,
          })}
          css={css`
            margin-right: 20px;
          `}
        />

        {currentConversation.messages.length !== 0 &&
          Object.keys(selectedPromptContexts).length > 0 && <EuiSpacer size={'m'} />}

        {(currentConversation.messages.length === 0 ||
          Object.keys(selectedPromptContexts).length > 0) && (
          <PromptEditor
            conversation={currentConversation}
            editingSystemPromptId={editingSystemPromptId}
            isNewConversation={currentConversation.messages.length === 0}
            isSettingsModalVisible={isSettingsModalVisible}
            promptContexts={promptContexts}
            promptTextPreview={promptTextPreview}
            onSystemPromptSelectionChange={handleOnSystemPromptSelectionChange}
            selectedPromptContexts={selectedPromptContexts}
            setIsSettingsModalVisible={setIsSettingsModalVisible}
            setSelectedPromptContexts={setSelectedPromptContexts}
          />
        )}

        <div ref={bottomRef} />
      </>
    ),
    [
      currentConversation,
      editingSystemPromptId,
      getComments,
      handleOnSystemPromptSelectionChange,
      isSettingsModalVisible,
      promptContexts,
      promptTextPreview,
      selectedPromptContexts,
      showAnonymizedValues,
    ]
  );

  const comments = useMemo(() => {
    if (isDisabled) {
      return (
        <>
          <EuiCommentList
            comments={connectorComments}
            css={css`
              margin-right: 20px;
            `}
          />
          <span ref={bottomRef} />
        </>
      );
    }

    return chatbotComments;
  }, [connectorComments, isDisabled, chatbotComments]);

  return (
    <>
      <EuiModalHeader
        css={css`
          align-items: flex-start;
          flex-direction: column;
        `}
      >
        {showTitle && (
          <>
            <EuiFlexGroup
              css={css`
                width: 100%;
              `}
              alignItems={'center'}
              justifyContent={'spaceBetween'}
            >
              <EuiFlexItem grow={false}>
                <AssistantTitle currentTitle={currentTitle} docLinks={docLinks} />
              </EuiFlexItem>

              <EuiFlexItem
                grow={false}
                css={css`
                  width: 335px;
                `}
              >
                <ConversationSelector
                  defaultConnectorId={defaultConnectorId}
                  defaultProvider={defaultProvider}
                  selectedConversationId={selectedConversationId}
                  onConversationSelected={handleOnConversationSelected}
                  shouldDisableKeyboardShortcut={shouldDisableConversationSelectorHotkeys}
                  isDisabled={isDisabled}
                />

                <>
                  <EuiSpacer size={'s'} />
                  <EuiFlexGroup alignItems="center" gutterSize="none" justifyContent="spaceBetween">
                    <EuiFlexItem grow={false}>
                      <EuiToolTip
                        content={i18n.SHOW_ANONYMIZED_TOOLTIP}
                        position="left"
                        repositionOnScroll={true}
                      >
                        <EuiSwitch
                          checked={
                            currentConversation.replacements != null &&
                            Object.keys(currentConversation.replacements).length > 0 &&
                            showAnonymizedValues
                          }
                          compressed={true}
                          disabled={currentConversation.replacements == null}
                          label={i18n.SHOW_ANONYMIZED}
                          onChange={onToggleShowAnonymizedValues}
                        />
                      </EuiToolTip>
                    </EuiFlexItem>

                    <EuiFlexItem grow={false}>
                      <AssistantSettingsButton
                        defaultConnectorId={defaultConnectorId}
                        defaultProvider={defaultProvider}
                        isDisabled={isDisabled}
                        isSettingsModalVisible={isSettingsModalVisible}
                        selectedConversation={currentConversation}
                        setIsSettingsModalVisible={setIsSettingsModalVisible}
                        setSelectedConversationId={setSelectedConversationId}
                      />
                    </EuiFlexItem>
                  </EuiFlexGroup>
                </>
              </EuiFlexItem>
            </EuiFlexGroup>
            <EuiHorizontalRule margin={'m'} />
          </>
        )}

        {/* Create portals for each EuiCodeBlock to add the `Investigate in Timeline` action */}
        {createCodeBlockPortals()}

        {!isDisabled && (
          <>
            <ContextPills
              defaultAllow={defaultAllow}
              defaultAllowReplacement={defaultAllowReplacement}
              promptContexts={promptContexts}
              selectedPromptContexts={selectedPromptContexts}
              setSelectedPromptContexts={setSelectedPromptContexts}
            />
            {Object.keys(promptContexts).length > 0 && <EuiSpacer size={'s'} />}
          </>
        )}
      </EuiModalHeader>
      <EuiModalBody>
        {comments}

        {!isDisabled && showMissingConnectorCallout && areConnectorsFetched && (
          <>
            <EuiSpacer />
            <EuiFlexGroup justifyContent="spaceAround">
              <EuiFlexItem grow={false}>
                <ConnectorMissingCallout
                  isSettingsModalVisible={isSettingsModalVisible}
                  setIsSettingsModalVisible={setIsSettingsModalVisible}
                />
              </EuiFlexItem>
            </EuiFlexGroup>
          </>
        )}
      </EuiModalBody>
      <EuiModalFooter
        css={css`
          align-items: flex-start;
          flex-direction: column;
        `}
      >
        {!isAssistantEnabled ? (
          <EuiFlexGroup
            justifyContent="spaceAround"
            css={css`
              width: 100%;
            `}
          >
            <EuiFlexItem grow={false}>
              {<UpgradeButtons basePath={http.basePath.get()} />}
            </EuiFlexItem>
          </EuiFlexGroup>
        ) : (
          isWelcomeSetup && (
            <EuiFlexGroup
              css={css`
                width: 100%;
              `}
            >
              <EuiFlexItem>{connectorPrompt}</EuiFlexItem>
            </EuiFlexGroup>
          )
        )}
        <EuiFlexGroup
          gutterSize="none"
          css={css`
            width: 100%;
          `}
        >
          <EuiFlexItem>
            <PromptTextArea
              onPromptSubmit={handleSendMessage}
              ref={promptTextAreaRef}
              handlePromptChange={handlePromptChange}
              value={isSendingDisabled ? '' : userPrompt ?? ''}
              isDisabled={isSendingDisabled}
            />
          </EuiFlexItem>

          <EuiFlexItem
            grow={false}
            css={css`
              left: -34px;
              position: relative;
              top: 11px;
            `}
          >
            <EuiFlexGroup
              direction="column"
              gutterSize="xs"
              css={css`
                position: absolute;
              `}
            >
              <EuiFlexItem grow={false}>
                <EuiToolTip position="right" content={i18n.CLEAR_CHAT}>
                  <EuiButtonIcon
                    display="base"
                    iconType="cross"
                    isDisabled={isSendingDisabled}
                    aria-label={i18n.CLEAR_CHAT}
                    color="danger"
                    onClick={handleOnChatCleared}
                  />
                </EuiToolTip>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiToolTip position="right" content={i18n.SUBMIT_MESSAGE}>
                  <EuiButtonIcon
                    display="base"
                    iconType="returnKey"
                    isDisabled={isSendingDisabled}
                    aria-label={i18n.SUBMIT_MESSAGE}
                    color="primary"
                    onClick={handleButtonSendMessage}
                    isLoading={isLoading}
                  />
                </EuiToolTip>
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiFlexItem>
        </EuiFlexGroup>
        {!isDisabled && (
          <QuickPrompts
            setInput={setUserPrompt}
            setIsSettingsModalVisible={setIsSettingsModalVisible}
          />
        )}
      </EuiModalFooter>
    </>
  );
};

AssistantComponent.displayName = 'AssistantComponent';

export const Assistant = React.memo(AssistantComponent);
