/**
 * NrdsMessageContent — NRDS-specific assistant message content renderer.
 *
 * Renders PlotlyChart, FlowpathsPmtilesMap, or query results inline (standalone)
 * or as panel indicators (embedded in tethysdash). Injected into core's
 * <Chatbox> via the MessageRenderer prop.
 */

import styled from "styled-components";
import { MarkdownContent } from "@chatbox/core/components";
import PlotlyChart from "./PlotlyChart";
import FlowpathsPmtilesMap from "./FlowpathsPmtilesMap";

const PanelIndicator = styled.p`
  margin: 0;
  color: ${({ theme }) => theme.colors.textStatus};
`;

const MapWrapper = styled.div`
  width: 100%;
  min-height: 500px;
  margin-top: ${({ theme }) => theme.spacing.lg};
  box-sizing: border-box;
`;

const PlotWrapper = styled.div`
  width: 100%;
  min-height: 360px;
  margin-top: ${({ theme }) => theme.spacing.lg};
  box-sizing: border-box;
`;

export default function NrdsMessageContent({ message, isEmbedded }) {
  if (message.mapConfig) {
    return isEmbedded ? (
      <PanelIndicator>Map updated in Map panel</PanelIndicator>
    ) : (
      <MapWrapper>
        <FlowpathsPmtilesMap mapConfig={message.mapConfig} />
      </MapWrapper>
    );
  }
  if (message.plotlyFigure) {
    return isEmbedded ? (
      <PanelIndicator>Chart created on dashboard</PanelIndicator>
    ) : (
      <PlotWrapper>
        <PlotlyChart figure={message.plotlyFigure} />
      </PlotWrapper>
    );
  }
  if (message.queryResult) {
    return isEmbedded ? (
      <PanelIndicator>Query results sent to Query panel</PanelIndicator>
    ) : (
      <MarkdownContent content={message.content || JSON.stringify(message.queryResult.data, null, 2)} />
    );
  }
  if (message.content) {
    return <MarkdownContent content={message.content} />;
  }
  return null;
}
