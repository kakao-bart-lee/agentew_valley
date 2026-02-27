/**
 * useAgentBridge - Zustand agentStore → OfficeState 어댑터 훅
 *
 * agentStore의 agents Map을 구독하여 OfficeState 메서드를 호출.
 * pixel-agents의 useExtensionMessages.ts를 대체.
 */

import { useEffect, useRef } from 'react'
import { useAgentStore } from '../../stores/agentStore'
import type { AgentLiveState } from '../../types/agent'
import type { OfficeState } from '../engine/officeState'
import type { CharacterKind } from '../types'

/** Determine character kind from AgentLiveState */
function determineCharacterKind(agent: AgentLiveState): CharacterKind {
  if (agent.parent_agent_id) return 'chicken'          // sub-agent
  if (agent.child_agent_ids.length > 0) return 'cat'   // orchestrator
  return 'cow'                                          // independent agent
}

/** string UUID → number ID 매핑 */
function useIdMap() {
  const mapRef = useRef<Map<string, number>>(new Map())
  const counterRef = useRef(1)

  function getOrCreateId(agentId: string): number {
    let numId = mapRef.current.get(agentId)
    if (numId === undefined) {
      numId = counterRef.current++
      mapRef.current.set(agentId, numId)
    }
    return numId
  }

  function deleteId(agentId: string): void {
    mapRef.current.delete(agentId)
  }

  function getId(agentId: string): number | undefined {
    return mapRef.current.get(agentId)
  }

  return { getOrCreateId, deleteId, getId }
}

/**
 * AgentStatus → OfficeState 메서드 매핑
 * acting: setAgentActive(true) + setAgentTool
 * thinking: setAgentActive(false) + setAgentTool(null)
 * idle: setAgentActive(false)
 * waiting_input: showWaitingBubble
 * waiting_permission: showPermissionBubble
 * error: showWaitingBubble (임시)
 */
function applyAgentStatus(
  officeState: OfficeState,
  numId: number,
  agent: AgentLiveState,
  prevStatus: string | undefined,
): void {
  const { status, current_tool } = agent

  switch (status) {
    case 'acting':
      officeState.setAgentActive(numId, true)
      officeState.setAgentTool(numId, current_tool ?? null)
      if (prevStatus === 'waiting_permission') {
        officeState.clearPermissionBubble(numId)
      }
      break

    case 'thinking':
      officeState.setAgentActive(numId, false)
      officeState.setAgentTool(numId, null)
      if (prevStatus === 'waiting_permission') {
        officeState.clearPermissionBubble(numId)
      }
      break

    case 'idle':
      officeState.setAgentActive(numId, false)
      officeState.setAgentTool(numId, null)
      break

    case 'waiting_input':
      officeState.setAgentActive(numId, false)
      officeState.showWaitingBubble(numId)
      break

    case 'waiting_permission':
      officeState.setAgentActive(numId, false)
      officeState.showPermissionBubble(numId)
      break

    case 'error':
      officeState.setAgentActive(numId, false)
      officeState.showWaitingBubble(numId)
      break
  }
}

export function useAgentBridge(getOfficeState: () => OfficeState): void {
  const { getOrCreateId, deleteId, getId } = useIdMap()

  // 이전 에이전트 상태 추적 (상태 변화 감지)
  const prevAgentsRef = useRef<Map<string, AgentLiveState>>(new Map())
  // 이전 status 추적 (permission bubble 클리어 등)
  const prevStatusRef = useRef<Map<string, string>>(new Map())
  // 서브에이전트 추적: parentId:agentId → true
  const subagentKeysRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const unsub = useAgentStore.subscribe((state) => {
      const officeState = getOfficeState()
      const currentAgents = state.agents
      const prevAgents = prevAgentsRef.current

      // 1. 제거된 에이전트 처리
      for (const [agentId] of prevAgents) {
        if (!currentAgents.has(agentId)) {
          const numId = getId(agentId)
          if (numId !== undefined) {
            const agent = prevAgents.get(agentId)!
            if (agent.parent_agent_id) {
              // 서브에이전트 제거
              const parentNumId = getId(agent.parent_agent_id)
              if (parentNumId !== undefined) {
                officeState.removeSubagent(parentNumId, agentId)
                subagentKeysRef.current.delete(`${agent.parent_agent_id}:${agentId}`)
              }
            } else {
              officeState.removeAgent(numId)
            }
            deleteId(agentId)
          }
          prevStatusRef.current.delete(agentId)
        }
      }

      // 2. 새 에이전트 추가 및 상태 업데이트
      for (const [agentId, agent] of currentAgents) {
        const prevAgent = prevAgents.get(agentId)

        if (!prevAgent) {
          // 신규 에이전트
          if (agent.parent_agent_id) {
            // 서브에이전트: 부모가 먼저 등록되어야 함
            const parentNumId = getId(agent.parent_agent_id)
            if (parentNumId !== undefined) {
              officeState.addSubagent(parentNumId, agentId)
              subagentKeysRef.current.add(`${agent.parent_agent_id}:${agentId}`)
              // 서브에이전트 ID도 매핑 (나중에 제거할 때 사용)
              const subNumId = officeState.getSubagentId(parentNumId, agentId)
              if (subNumId !== null) {
                // subagent는 officeState 내부 ID를 쓰므로 별도 매핑 불필요
              }
            }
          } else {
            // 일반 에이전트
            const numId = getOrCreateId(agentId)
            const kind = determineCharacterKind(agent)
            officeState.addAgent(numId, undefined, undefined, undefined, undefined, kind)
          }
        }

        // 상태 업데이트
        const numId = getId(agentId)
        if (numId !== undefined && agent !== prevAgent) {
          const prevStatus = prevStatusRef.current.get(agentId)
          applyAgentStatus(officeState, numId, agent, prevStatus)
          prevStatusRef.current.set(agentId, agent.status)
        }
      }

      // prev 스냅샷 업데이트 (새 Map으로 교체)
      prevAgentsRef.current = new Map(currentAgents)
    })

    return () => {
      unsub()
    }
  }, [getOfficeState, getOrCreateId, deleteId, getId])
}
