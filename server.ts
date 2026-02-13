import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increase limit for base64 images
app.use(express.static('public'));

type MessageContent = string | Array<{ type: string; text?: string; image_url?: { url: string } }>;

interface StoredMessage {
  role: 'user' | 'assistant';
  content: MessageContent;
}

interface ChatRequest {
  message: string;
  conversationId?: string;
  username?: string;
  image?: string;
}

interface ToolCallInfo {
  name: string;
  arguments: any;
  result: any;
}

interface ChatResponse {
  response: string;
  conversationId: string;
  messageId: string;
  toolCalls?: ToolCallInfo[];
}

interface FeedbackRequest {
  messageId: string;
  feedback: 'up' | 'down';
  username?: string;
  conversationId?: string;
}

// Store conversation history in memory (in production, use a database)
const conversations = new Map<string, StoredMessage[]>();

// Store feedback data (in production, use a database)
const feedbackStore = new Map<string, { feedback: 'up' | 'down'; username?: string; timestamp: number }>();

// Define mock tools for the agent
const mockTools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get the current weather for a specific location',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'The city and state, e.g. San Francisco, CA',
          },
          unit: {
            type: 'string',
            enum: ['celsius', 'fahrenheit'],
            description: 'The temperature unit to use',
          },
        },
        required: ['location'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description: 'Perform a mathematical calculation',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'The mathematical expression to evaluate, e.g. "2 + 2" or "sqrt(16)"',
          },
        },
        required: ['expression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: 'Get the current time for a specific timezone',
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'The timezone, e.g. "America/New_York", "Europe/London", or "Asia/Tokyo"',
          },
        },
        required: ['timezone'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_database',
      description: 'Search a mock database for user information',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return',
          },
        },
        required: ['query'],
      },
    },
  },
];

// Mock tool implementations
function executeMockTool(toolName: string, args: any): string {
  switch (toolName) {
    case 'get_weather':
      const { location, unit = 'fahrenheit' } = args;
      const temp = unit === 'celsius' ? 22 : 72;
      return JSON.stringify({
        location,
        temperature: temp,
        unit,
        condition: 'Partly cloudy',
        humidity: 65,
        wind_speed: 10,
      });

    case 'calculate':
      try {
        // Simple eval for demo purposes (DO NOT use in production!)
        const result = eval(args.expression);
        return JSON.stringify({ expression: args.expression, result });
      } catch (error) {
        return JSON.stringify({ error: 'Invalid expression' });
      }

    case 'get_current_time':
      const { timezone = 'UTC' } = args;
      const now = new Date();
      const timeString = now.toLocaleString('en-US', { timeZone: timezone });
      return JSON.stringify({
        timezone,
        current_time: timeString,
        unix_timestamp: now.getTime(),
      });

    case 'search_database':
      const { query, limit = 5 } = args;
      // Mock database results
      const mockResults = [
        { id: 1, name: 'Alice Johnson', email: 'alice@example.com', role: 'Engineer' },
        { id: 2, name: 'Bob Smith', email: 'bob@example.com', role: 'Designer' },
        { id: 3, name: 'Carol Williams', email: 'carol@example.com', role: 'Manager' },
        { id: 4, name: 'David Brown', email: 'david@example.com', role: 'Engineer' },
        { id: 5, name: 'Eve Davis', email: 'eve@example.com', role: 'Product Manager' },
      ];
      const filtered = mockResults
        .filter(item =>
          item.name.toLowerCase().includes(query.toLowerCase()) ||
          item.role.toLowerCase().includes(query.toLowerCase())
        )
        .slice(0, limit);
      return JSON.stringify({ results: filtered, total: filtered.length });

    default:
      return JSON.stringify({ error: 'Unknown tool' });
  }
}

app.post('/api/chat', async (req: Request<{}, ChatResponse, ChatRequest>, res: Response<ChatResponse | { error: string }>) => {
  try {
    const { message, conversationId, username, image } = req.body;

    if (!message && !image) {
      return res.status(400).json({ error: 'Message or image is required' });
    }

    // Log username for testing
    console.log(`[${new Date().toISOString()}] User: ${username || 'Anonymous'} - Message: ${message}`);

    // Get or create conversation history
    const conversationIdToUse = conversationId || `conv_${Date.now()}`;
    const messages = conversations.get(conversationIdToUse) || [];

    // Generate message ID for feedback
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Add user message to history
    let userContent: MessageContent;

    if (image) {
      // If there's an image, use the vision format
      userContent = [
        { type: 'text', text: message || 'What is in this image?' },
        {
          type: 'image_url',
          image_url: { url: image }
        }
      ];
    } else {
      userContent = message;
    }

    messages.push({ role: 'user', content: userContent });

    // Use appropriate model based on whether there's an image
    const model = image ? 'gpt-4o-mini' : 'gpt-4o-mini';

    // Convert stored messages to OpenAI format
    const openAIMessages: ChatCompletionMessageParam[] = messages.map(msg => {
      if (msg.role === 'user') {
        return {
          role: 'user' as const,
          content: msg.content as string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>
        };
      } else {
        return {
          role: 'assistant' as const,
          content: typeof msg.content === 'string' ? msg.content : ''
        };
      }
    });

    // Generate response using OpenAI with tool support
    let completion = await openai.chat.completions.create({
      model: model,
      messages: openAIMessages,
      tools: mockTools,
      tool_choice: 'auto',
    });

    let responseMessage = completion.choices[0].message;
    const toolCallsInfo: ToolCallInfo[] = [];

    // Handle tool calls if present
    while (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      // Add the assistant's message with tool calls to the conversation
      messages.push({
        role: 'assistant',
        content: responseMessage.content || '',
      });

      // Add tool calls to the messages array for OpenAI
      openAIMessages.push(responseMessage as any);

      // Execute each tool call
      for (const toolCall of responseMessage.tool_calls) {
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments);

        console.log(`[${new Date().toISOString()}] Tool Call: ${toolName} with args:`, toolArgs);

        const toolResult = executeMockTool(toolName, toolArgs);
        const parsedResult = JSON.parse(toolResult);

        // Store tool call info for response
        toolCallsInfo.push({
          name: toolName,
          arguments: toolArgs,
          result: parsedResult,
        });

        // Add tool result to messages
        openAIMessages.push({
          role: 'tool',
          content: toolResult,
          tool_call_id: toolCall.id,
        });
      }

      // Get the next response from OpenAI
      completion = await openai.chat.completions.create({
        model: model,
        messages: openAIMessages,
        tools: mockTools,
        tool_choice: 'auto',
      });

      responseMessage = completion.choices[0].message;
    }

    const text = responseMessage.content || '';

    // Add final assistant response to history
    messages.push({ role: 'assistant', content: text });

    // Store updated conversation
    conversations.set(conversationIdToUse, messages);

    res.json({
      response: text,
      conversationId: conversationIdToUse,
      messageId,
      toolCalls: toolCallsInfo.length > 0 ? toolCallsInfo : undefined,
    });
  } catch (error) {
    console.error('Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to generate response';
    res.status(500).json({ error: errorMessage });
  }
});

app.post('/api/feedback', (req: Request<{}, {}, FeedbackRequest>, res: Response) => {
  try {
    const { messageId, feedback, username, conversationId } = req.body;

    if (!messageId || !feedback) {
      return res.status(400).json({ error: 'messageId and feedback are required' });
    }

    // Store feedback
    feedbackStore.set(messageId, {
      feedback,
      username,
      timestamp: Date.now(),
    });

    console.log(`[${new Date().toISOString()}] Feedback: ${feedback} from ${username || 'Anonymous'} on message ${messageId} (conversation: ${conversationId})`);

    res.json({ success: true });
  } catch (error) {
    console.error('Error storing feedback:', error);
    res.status(500).json({ error: 'Failed to store feedback' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
