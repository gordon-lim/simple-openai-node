import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

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

interface ChatResponse {
  response: string;
  conversationId: string;
  messageId: string;
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

    // Generate response using OpenAI
    const completion = await openai.chat.completions.create({
      model: model,
      messages: openAIMessages,
    });

    const text = completion.choices[0].message.content || '';

    // Add assistant response to history
    messages.push({ role: 'assistant', content: text });

    // Store updated conversation
    conversations.set(conversationIdToUse, messages);

    res.json({
      response: text,
      conversationId: conversationIdToUse,
      messageId,
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
