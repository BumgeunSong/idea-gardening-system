import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock OpenAI before importing llm
vi.mock('openai', () => {
  const createMock = vi.fn();
  return {
    default: class {
      chat = { completions: { create: createMock } };
    },
    __createMock: createMock,
  };
});

// Mock tools module
vi.mock('../tools', () => ({
  executeTool: vi.fn(),
  CONVERSATION_TOOLS: [],
  QUESTION_TOOLS: [],
}));

import { chatWithTools } from '../llm';
import { executeTool } from '../tools';

// Get the mocked create function
async function getCreateMock() {
  const openaiModule = await import('openai') as unknown as { __createMock: ReturnType<typeof vi.fn> };
  return openaiModule.__createMock;
}

describe('chatWithTools', () => {
  let createMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    createMock = await getCreateMock();
  });

  it('returns text immediately when no tool_calls', async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: '안녕하세요!', tool_calls: null } }],
    });

    const result = await chatWithTools({
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result).toBe('안녕하세요!');
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('executes tool and loops when LLM emits tool_call', async () => {
    // First call: LLM requests a tool
    createMock.mockResolvedValueOnce({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'read_harvests', arguments: '{"count": 3}' },
          }],
        },
      }],
    });

    // Second call: LLM responds with text
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: '최근 수확물을 확인했어요.', tool_calls: null } }],
    });

    vi.mocked(executeTool).mockReturnValueOnce({
      success: true,
      data: '[{"seed": "test seed"}]',
    });

    const result = await chatWithTools({
      messages: [{ role: 'user', content: 'test' }],
      tools: [{ type: 'function', function: { name: 'read_harvests', description: 'test', parameters: { type: 'object', properties: {} } } }],
    });

    expect(result).toBe('최근 수확물을 확인했어요.');
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenCalledWith('read_harvests', { count: 3 }, {});
  });

  it('stops after 3 iterations (hard cap)', async () => {
    // 3 iterations of tool calls
    for (let i = 0; i < 3; i++) {
      createMock.mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: `call_${i}`,
              type: 'function',
              function: { name: 'list_tags', arguments: `{"iter": ${i}}` },
            }],
          },
        }],
      });
    }

    // Final call without tools should return text
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: 'Final response after max iterations', tool_calls: null } }],
    });

    vi.mocked(executeTool).mockReturnValue({ success: true, data: '[]' });

    const result = await chatWithTools({
      messages: [{ role: 'user', content: 'test' }],
      tools: [{ type: 'function', function: { name: 'list_tags', description: 'test', parameters: { type: 'object', properties: {} } } }],
    });

    expect(result).toBe('Final response after max iterations');
    // 3 iterations + 1 final call = 4 total
    expect(createMock).toHaveBeenCalledTimes(4);
  });

  it('breaks on duplicate tool+args', async () => {
    const toolCall = {
      id: 'call_1',
      type: 'function' as const,
      function: { name: 'read_harvests', arguments: '{"count": 5}' },
    };

    // First call: tool request
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: null, tool_calls: [toolCall] } }],
    });

    // Second call: same tool+args (duplicate)
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: null, tool_calls: [{ ...toolCall, id: 'call_2' }] } }],
    });

    // Final call after duplicate detection
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: 'Broke out of duplicate loop', tool_calls: null } }],
    });

    vi.mocked(executeTool).mockReturnValue({ success: true, data: '[]' });

    const result = await chatWithTools({
      messages: [{ role: 'user', content: 'test' }],
      tools: [{ type: 'function', function: { name: 'read_harvests', description: 'test', parameters: { type: 'object', properties: {} } } }],
    });

    expect(result).toBe('Broke out of duplicate loop');
    // 2 iterations + 1 final call = 3 total
    expect(createMock).toHaveBeenCalledTimes(3);
  });

  it('applies response_format only when tools are stripped', async () => {
    // 3 tool call iterations to hit the cap
    for (let i = 0; i < 3; i++) {
      createMock.mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: `call_${i}`,
              type: 'function',
              function: { name: 'list_tags', arguments: `{"i": ${i}}` },
            }],
          },
        }],
      });
    }

    // Final forced-text call (tools stripped → response_format applied)
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: '{"questions": []}', tool_calls: null } }],
    });

    vi.mocked(executeTool).mockReturnValue({ success: true, data: '[]' });

    await chatWithTools({
      messages: [{ role: 'user', content: 'test' }],
      tools: [{ type: 'function', function: { name: 'list_tags', description: 'test', parameters: { type: 'object', properties: {} } } }],
      responseFormat: { type: 'json_object' },
    });

    // Iterations 0-1: tools active → no response_format
    expect(createMock.mock.calls[0][0].response_format).toBeUndefined();
    expect(createMock.mock.calls[1][0].response_format).toBeUndefined();
    // Iteration 2 (last): tools stripped → response_format applied
    expect(createMock.mock.calls[2][0].response_format).toEqual({ type: 'json_object' });
    // Final fallback call: response_format applied
    expect(createMock.mock.calls[3][0].response_format).toEqual({ type: 'json_object' });
  });

  it('handles malformed tool arguments gracefully', async () => {
    createMock.mockResolvedValueOnce({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'read_harvests', arguments: 'not valid json{' },
          }],
        },
      }],
    });

    // After malformed args, LLM gets error and responds with text
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: 'Recovered from bad args', tool_calls: null } }],
    });

    const result = await chatWithTools({
      messages: [{ role: 'user', content: 'test' }],
      tools: [{ type: 'function', function: { name: 'read_harvests', description: 'test', parameters: { type: 'object', properties: {} } } }],
    });

    expect(result).toBe('Recovered from bad args');
    // executeTool should NOT have been called for the malformed args
    expect(executeTool).not.toHaveBeenCalled();
  });
});
