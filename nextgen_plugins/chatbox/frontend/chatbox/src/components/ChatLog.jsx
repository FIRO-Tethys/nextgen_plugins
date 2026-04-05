import { forwardRef } from "react";
import styled from "styled-components";
import ChatMessage from "./ChatMessage";
import MarkdownContent from "./markdownContent";
import { Avatar, Bubble, ThinkingDropdown, BotIcon } from "./ChatMessage";

const LogSection = styled.section`
  display: grid;
  gap: ${({ theme }) => theme.spacing.lg};
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: ${({ theme }) => theme.spacing.xl};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radius.lg};
  background: ${({ theme }) => theme.colors.chatLogBg};
`;

const StatusText = styled.p`
  margin: 0;
  color: ${({ theme }) => theme.colors.textStatus};
`;

const LoadingRow = styled.div`
  display: flex;
  align-items: flex-start;
  gap: ${({ theme }) => theme.spacing.md};
  flex-direction: row;
`;

const ChatLog = forwardRef(function ChatLog(
  { messages, isEmbedded, loading, isThinkingEnabled, thinkingBuffer, contentBuffer },
  ref,
) {
  return (
    <LogSection ref={ref} role="log" aria-live="polite">
      {messages.map((message, index) => (
        <ChatMessage
          key={`${message.role}-${index}`}
          message={message}
          isEmbedded={isEmbedded}
        />
      ))}

      {loading && (
        <LoadingRow>
          <Avatar $isUser={false}>
            <BotIcon />
          </Avatar>
          <Bubble $isUser={false}>
            {isThinkingEnabled && thinkingBuffer && (
              <ThinkingDropdown open={!contentBuffer}>
                <summary>Thinking...</summary>
                <pre>{thinkingBuffer}</pre>
              </ThinkingDropdown>
            )}
            {contentBuffer ? (
              <MarkdownContent content={contentBuffer} />
            ) : (
              !thinkingBuffer && <StatusText>Running...</StatusText>
            )}
          </Bubble>
        </LoadingRow>
      )}
    </LogSection>
  );
});

export default ChatLog;
