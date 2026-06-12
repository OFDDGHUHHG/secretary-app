import express, { type Request, type Response } from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { LLMClient, TTSClient, ASRClient, Config } from "coze-coding-dev-sdk";
import { getSupabaseClient } from "./storage/database/supabase-client";

const app = express();
const port = process.env.PORT || 9091;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// File upload config
const uploadDir = '/tmp/uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Health check
app.get('/api/v1/health', (req, res) => {
  console.log('Health check success');
  res.status(200).json({ status: 'ok' });
});

// ==================== Memo APIs ====================

// Data storage directory
const dataDir = '/tmp/memos-data';
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Save memo to local file
const saveMemoToFile = (memo: any) => {
  const date = new Date().toISOString().split('T')[0];
  const dailyFile = path.join(dataDir, `memos_${date}.json`);
  
  let memos: any[] = [];
  if (fs.existsSync(dailyFile)) {
    try {
      memos = JSON.parse(fs.readFileSync(dailyFile, 'utf-8'));
    } catch (e) {
      memos = [];
    }
  }
  
  const existingIndex = memos.findIndex(m => m.id === memo.id);
  if (existingIndex >= 0) {
    memos[existingIndex] = memo;
  } else {
    memos.push(memo);
  }
  
  fs.writeFileSync(dailyFile, JSON.stringify(memos, null, 2), 'utf-8');
  return dailyFile;
};

// Delete memo from local file
const deleteMemoFromFile = (memo: any) => {
  const date = memo.created_at ? new Date(memo.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
  const dailyFile = path.join(dataDir, `memos_${date}.json`);
  
  if (fs.existsSync(dailyFile)) {
    try {
      let memos: any[] = JSON.parse(fs.readFileSync(dailyFile, 'utf-8'));
      memos = memos.filter(m => m.id !== memo.id);
      fs.writeFileSync(dailyFile, JSON.stringify(memos, null, 2), 'utf-8');
    } catch (e) {
      console.error('Delete from file error:', e);
    }
  }
};

// Get all memos
app.get('/api/v1/memos', async (req: Request, res: Response) => {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('memos')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw new Error(`查询失败: ${error.message}`);
    
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Get memos error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Get local files list
app.get('/api/v1/memos/files', async (req: Request, res: Response) => {
  try {
    if (!fs.existsSync(dataDir)) {
      return res.status(200).json({ success: true, data: [] });
    }
    
    const files = fs.readdirSync(dataDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const stats = fs.statSync(path.join(dataDir, f));
        return {
          name: f,
          path: path.join(dataDir, f),
          size: stats.size,
          modified: stats.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
    
    res.status(200).json({ success: true, data: files });
  } catch (error) {
    console.error('Get files error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Add new memo
app.post('/api/v1/memos', async (req: Request, res: Response) => {
  try {
    const { content, reminder_time } = req.body;
    if (!content) {
      return res.status(400).json({ success: false, error: '内容不能为空' });
    }

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('memos')
      .insert({ 
        content,
        reminder_time: reminder_time || null,
      })
      .select()
      .single();
    
    if (error) throw new Error(`插入失败: ${error.message}`);
    
    // Save to local file
    const filePath = saveMemoToFile(data);
    data.file_path = filePath;
    
    // Update with file path
    await client
      .from('memos')
      .update({ file_path: filePath })
      .eq('id', data.id);
    
    res.status(201).json({ success: true, data });
  } catch (error) {
    console.error('Add memo error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Update memo
app.put('/api/v1/memos/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { content, reminder_time } = req.body;
    if (!content) {
      return res.status(400).json({ success: false, error: '内容不能为空' });
    }

    const client = getSupabaseClient();
    const { data: oldData } = await client
      .from('memos')
      .select('*')
      .eq('id', parseInt(id))
      .single();
    
    const { data, error } = await client
      .from('memos')
      .update({ 
        content, 
        updated_at: new Date().toISOString(),
        reminder_time: reminder_time || null,
      })
      .eq('id', parseInt(id))
      .select()
      .single();
    
    if (error) throw new Error(`更新失败: ${error.message}`);
    
    // Update local file
    if (oldData) {
      deleteMemoFromFile(oldData);
    }
    saveMemoToFile(data);
    
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Update memo error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Delete memo
app.delete('/api/v1/memos/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const client = getSupabaseClient();
    
    // Get memo before deleting
    const { data: memo } = await client
      .from('memos')
      .select('*')
      .eq('id', parseInt(id))
      .single();
    
    const { error } = await client
      .from('memos')
      .delete()
      .eq('id', parseInt(id));
    
    if (error) throw new Error(`删除失败: ${error.message}`);
    
    // Delete from local file
    if (memo) {
      deleteMemoFromFile(memo);
    }
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Delete memo error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// ==================== Voice Processing APIs ====================

// Upload audio and recognize speech (ASR)
app.post('/api/v1/asr', upload.single('audio'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '未提供音频文件' });
    }

    // Save file temporarily
    const fileId = uuidv4();
    const ext = path.extname(req.file.originalname) || '.m4a';
    const tempPath = path.join(uploadDir, `${fileId}${ext}`);
    fs.writeFileSync(tempPath, req.file.buffer);

    // Call ASR service
    const config = new Config();
    const asrClient = new ASRClient(config);
    
    const result = await asrClient.recognize({
      uid: fileId,
      base64Data: req.file.buffer.toString('base64')
    });

    // Cleanup temp file
    fs.unlinkSync(tempPath);

    console.log('ASR result:', result.text);
    res.status(200).json({ success: true, text: result.text });
  } catch (error) {
    console.error('ASR error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Text-to-Speech synthesis
app.post('/api/v1/tts', async (req: Request, res: Response) => {
  try {
    const { text, speaker } = req.body;
    if (!text) {
      return res.status(400).json({ success: false, error: '文本内容不能为空' });
    }

    const config = new Config();
    const ttsClient = new TTSClient(config);
    
    const response = await ttsClient.synthesize({
      uid: uuidv4(),
      text,
      speaker: speaker || 'zh_female_xiaohe_uranus_bigtts',
      audioFormat: 'mp3'
    });

    res.status(200).json({ success: true, audioUri: response.audioUri });
  } catch (error) {
    console.error('TTS error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Chat with AI (using LLM + memos context)
app.post('/api/v1/chat', async (req: Request, res: Response) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ success: false, error: '消息不能为空' });
    }

    // Get all memos for context
    const client = getSupabaseClient();
    const { data: memos, error } = await client
      .from('memos')
      .select('content, created_at')
      .order('created_at', { ascending: false });
    
    if (error) throw new Error(`查询记忆失败: ${error.message}`);

    // Build context from memos
    const memosContext = memos && memos.length > 0
      ? memos.map((m, i) => `[记忆${memos.length - i}] ${m.content}`).join('\n')
      : '暂无记忆记录';

    // Build system prompt for reminder detection
    const systemPrompt = `你是用户的贴身秘书，名字叫"小秘"。你的职责是：
1. 当用户告诉你需要记住的事情时，简洁确认已记住
2. 当用户询问之前记住的内容时，根据记忆回答
3. 如果记忆中有相关信息，告诉用户具体内容和记录时间
4. 如果记忆中没有相关信息，诚实地告诉用户"我还没有记住这件事"
5. 当用户提到需要提醒时（如"明天两点提醒我开会"），在回复中明确确认提醒时间

用户已记住的内容：
${memosContext}

请用自然、友好的语气回答用户。`;

    // Call LLM
    const config = new Config();
    const llmClient = new LLMClient(config);
    
    let aiResponse = '';
    const stream = llmClient.stream([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message }
    ], { temperature: 0.7 });

    for await (const chunk of stream) {
      if (chunk.content) {
        aiResponse += chunk.content.toString();
      }
    }

    res.status(200).json({ success: true, response: aiResponse });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Voice chat (ASR + Chat + TTS)
app.post('/api/v1/voice-chat', upload.single('audio'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '未提供音频文件' });
    }

    const fileId = uuidv4();

    // Step 1: ASR - recognize speech
    const config = new Config();
    const asrClient = new ASRClient(config);
    
    const asrResult = await asrClient.recognize({
      uid: fileId,
      base64Data: req.file.buffer.toString('base64')
    });

    const userMessage = asrResult.text;
    console.log('User said:', userMessage);

    // Step 2: Get memos context
    const client = getSupabaseClient();
    const { data: memos, error } = await client
      .from('memos')
      .select('content, created_at')
      .order('created_at', { ascending: false });
    
    if (error) throw new Error(`查询记忆失败: ${error.message}`);

    // Check if user wants to remember something
    const rememberPatterns = [
      /记住/i,
      /帮我记/i,
      /记一下/i,
      /记着/i,
      /别忘了/i,
      /要记住/i,
      /提醒我/i,
      /到时候/i
    ];

    const isRememberIntent = rememberPatterns.some(p => p.test(userMessage));

    // Parse reminder time from user message
    const parseReminderTime = (text: string): string | null => {
      const now = new Date();
      let reminderTime: Date | null = null;
      
      // Pattern: 明天 X 点
      const tomorrowMatch = text.match(/明天[早上下午晚上]?(\d{1,2})[点:]?(\d{0,2})/);
      if (tomorrowMatch) {
        const hour = parseInt(tomorrowMatch[1]);
        const minute = tomorrowMatch[2] ? parseInt(tomorrowMatch[2]) : 0;
        reminderTime = new Date(now);
        reminderTime.setDate(reminderTime.getDate() + 1);
        reminderTime.setHours(hour, minute, 0, 0);
      }
      
      // Pattern: 今天 X 点
      const todayMatch = text.match(/今天[早上下午晚上]?(\d{1,2})[点:]?(\d{0,2})/);
      if (todayMatch) {
        const hour = parseInt(todayMatch[1]);
        const minute = todayMatch[2] ? parseInt(todayMatch[2]) : 0;
        reminderTime = new Date(now);
        reminderTime.setHours(hour, minute, 0, 0);
      }
      
      // Pattern: X分钟后
      const minMatch = text.match(/(\d+)\s*分钟\s*(后|提醒)/);
      if (minMatch) {
        const mins = parseInt(minMatch[1]);
        reminderTime = new Date(now.getTime() + mins * 60 * 1000);
      }
      
      // Pattern: X小时后
      const hourMatch = text.match(/(\d+)\s*小时\s*(后|提醒)/);
      if (hourMatch) {
        const hours = parseInt(hourMatch[1]);
        reminderTime = new Date(now.getTime() + hours * 60 * 60 * 1000);
      }
      
      // Check if future time
      if (reminderTime && reminderTime > now) {
        return reminderTime.toISOString();
      }
      return null;
    };

    let aiResponse: string;
    let shouldSaveMemo = false;
    let memoContent = '';
    let reminderTime: string | null = null;

    if (isRememberIntent) {
      // Extract what to remember
      let cleanContent = userMessage
        .replace(/记住/gi, '')
        .replace(/帮我记/gi, '')
        .replace(/记一下/gi, '')
        .replace(/记着/gi, '')
        .replace(/别忘了/gi, '')
        .replace(/要记住/gi, '')
        .replace(/提醒我/gi, '')
        .replace(/到时候/gi, '')
        .trim();
      
      // Parse reminder time from original message
      reminderTime = parseReminderTime(userMessage);
      
      if (cleanContent) {
        memoContent = cleanContent;
        shouldSaveMemo = true;
        
        if (reminderTime) {
          const rt = new Date(reminderTime);
          const timeStr = rt.toLocaleString('zh-CN', { 
            month: 'short', 
            day: 'numeric',
            hour: '2-digit', 
            minute: '2-digit' 
          });
          aiResponse = `好的，我会帮您记住"${cleanContent}"，并在${timeStr}提醒您。`;
        } else {
          aiResponse = `好的，我已经记住"${cleanContent}"了。`;
        }
      } else {
        aiResponse = '好的，要我记住什么呢？请再说一遍？';
      }
    } else {
      // Build context and chat
      const memosContext = memos && memos.length > 0
        ? memos.map((m, i) => `[记忆${memos.length - i}] ${m.content}`).join('\n')
        : '暂无记忆记录';

      const systemPrompt = `你是用户的贴身秘书，名字叫"小秘"。你的职责是：
1. 当用户告诉你需要记住的事情时，简洁确认已记住
2. 当用户询问之前记住的内容时，根据记忆回答
3. 如果记忆中有相关信息，告诉用户具体内容和记录时间
4. 如果记忆中没有相关信息，诚实地告诉用户"我还没有记住这件事"
5. 当用户提到需要提醒时（如"明天两点提醒我开会"），在回复中明确确认提醒时间

用户已记住的内容：
${memosContext}

请用自然、友好的语气回答用户。`;

      const llmClient = new LLMClient(config);
      const stream = llmClient.stream([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ], { temperature: 0.7 });

      aiResponse = '';
      for await (const chunk of stream) {
        if (chunk.content) {
          aiResponse += chunk.content.toString();
        }
      }
    }

    // Step 3: Save memo if needed (with reminder time)
    let savedMemo = null;
    if (shouldSaveMemo && memoContent) {
      const { data } = await client
        .from('memos')
        .insert({ 
          content: memoContent,
          reminder_time: reminderTime || null
        })
        .select()
        .single();
      savedMemo = data;
    }

    // Step 4: TTS - synthesize response
    const ttsClient = new TTSClient(config);
    const ttsResult = await ttsClient.synthesize({
      uid: uuidv4(),
      text: aiResponse,
      speaker: 'zh_female_xiaohe_uranus_bigtts',
      audioFormat: 'mp3'
    });

    res.status(200).json({
      success: true,
      recognizedText: userMessage,
      aiResponse,
      audioUri: ttsResult.audioUri,
      memo: savedMemo
    });
  } catch (error) {
    console.error('Voice chat error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}/`);
});
