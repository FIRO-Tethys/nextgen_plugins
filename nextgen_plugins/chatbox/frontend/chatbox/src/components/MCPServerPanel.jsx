import { useState } from "react";
import styled from "styled-components";

const Panel = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${({ theme }) => `${theme.spacing.lg} ${theme.spacing.xl}`};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  flex-shrink: 0;
`;

const Title = styled.span`
  font-weight: 600;
  font-size: ${({ theme }) => theme.fontSize.lg};
  color: ${({ theme }) => theme.colors.text};
`;

const CloseBtn = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: ${({ theme }) => theme.colors.textMuted};
  font-size: 1.2rem;
  line-height: 1;
  &:hover {
    color: ${({ theme }) => theme.colors.text};
  }
`;

const ServerList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: ${({ theme }) => theme.spacing.lg};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const ServerCard = styled.div`
  display: flex;
  align-items: flex-start;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.lg};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radius.sm};
  background: ${({ theme }) => theme.colors.surface};
`;

const StatusDot = styled.div`
  width: 10px;
  height: 10px;
  border-radius: ${({ theme }) => theme.radius.circle};
  background: ${(props) => (props.$enabled ? "#4caf50" : "#bbb")};
  margin-top: 4px;
  flex-shrink: 0;
  cursor: ${(props) => (props.$clickable ? "pointer" : "default")};
`;

const ServerInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const ServerName = styled.div`
  font-weight: 600;
  font-size: ${({ theme }) => theme.fontSize.base};
  color: ${({ theme }) => theme.colors.text};
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const DefaultBadge = styled.span`
  font-size: 0.7rem;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.primary};
  background: ${({ theme }) => theme.colors.primaryLight};
  padding: 1px 6px;
  border-radius: ${({ theme }) => theme.radius.full};
`;

const ServerUrl = styled.div`
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.textMuted};
  word-break: break-all;
  margin-top: 2px;
`;

const RemoveBtn = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  color: ${({ theme }) => theme.colors.textMuted};
  padding: 2px;
  flex-shrink: 0;
  &:hover {
    color: ${({ theme }) => theme.colors.error};
  }
`;

const AddForm = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.lg};
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  flex-shrink: 0;
`;

const Input = styled.input`
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radius.sm};
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  font-size: ${({ theme }) => theme.fontSize.sm};
  outline: none;
  &:focus {
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const AddButton = styled.button`
  border: none;
  border-radius: ${({ theme }) => theme.radius.sm};
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.lg}`};
  font-size: ${({ theme }) => theme.fontSize.sm};
  font-weight: 600;
  color: ${({ theme }) => theme.colors.surface};
  background: ${({ theme }) => theme.colors.primary};
  cursor: pointer;
  align-self: flex-start;
  &:hover {
    background: ${({ theme }) => theme.colors.primaryHover};
  }
  &:disabled {
    background: ${({ theme }) => theme.colors.sendDisabled};
    cursor: not-allowed;
  }
`;

const EmptyText = styled.p`
  color: ${({ theme }) => theme.colors.textMuted};
  font-size: ${({ theme }) => theme.fontSize.sm};
  text-align: center;
  padding: ${({ theme }) => theme.spacing.xl};
`;

export default function MCPServerPanel({
  defaultServers,
  userServers,
  onAdd,
  onRemove,
  onToggle,
  onClose,
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  const handleAdd = (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    onAdd({ url: url.trim(), name: name.trim() });
    setName("");
    setUrl("");
  };

  const allServers = [
    ...defaultServers.map((s) => ({ ...s, isDefault: true, enabled: true })),
    ...userServers,
  ];

  return (
    <Panel>
      <Header>
        <Title>MCP Servers</Title>
        <CloseBtn onClick={onClose} aria-label="Close MCP panel">&times;</CloseBtn>
      </Header>

      <ServerList>
        {allServers.length === 0 && (
          <EmptyText>No MCP servers configured. Add one below.</EmptyText>
        )}
        {allServers.map((server) => (
          <ServerCard key={server.url}>
            <StatusDot
              $enabled={server.enabled !== false}
              $clickable={!server.isDefault}
              onClick={() => !server.isDefault && onToggle(server.url)}
              title={
                server.isDefault
                  ? "Default server (always enabled)"
                  : server.enabled !== false
                    ? "Click to disable"
                    : "Click to enable"
              }
            />
            <ServerInfo>
              <ServerName>
                {server.name || server.url}
                {server.isDefault && <DefaultBadge>default</DefaultBadge>}
              </ServerName>
              <ServerUrl>{server.url}</ServerUrl>
            </ServerInfo>
            {!server.isDefault && (
              <RemoveBtn
                onClick={() => onRemove(server.url)}
                aria-label={`Remove ${server.name || server.url}`}
                title="Remove server"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                </svg>
              </RemoveBtn>
            )}
          </ServerCard>
        ))}
      </ServerList>

      <AddForm onSubmit={handleAdd}>
        <Input
          placeholder="Server name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          placeholder="Server URL (e.g., http://localhost:9000/sse)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <AddButton type="submit" disabled={!url.trim()}>
          + Add Server
        </AddButton>
      </AddForm>
    </Panel>
  );
}
