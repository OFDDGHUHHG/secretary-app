import { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';
import { Screen } from '@/components/Screen';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

const API_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || 'http://localhost:9091';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  audioUri?: string;
  timestamp: Date;
  hasReminder?: boolean;
}

export default function AssistantPage() {
  const insets = useSafeAreaInsets();
  
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  
  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  // Request permissions on mount
  useEffect(() => {
    (async () => {
      // Request audio permission
      const { status: audioStatus } = await Audio.requestPermissionsAsync();
      setHasPermission(audioStatus === 'granted');
      if (audioStatus !== 'granted') {
        Alert.alert('权限提示', '需要麦克风权限才能使用语音功能');
      }
      
      // Request notification permission
      const { status: notifStatus } = await Notifications.requestPermissionsAsync();
      if (notifStatus !== 'granted') {
        console.log('通知权限未授权');
      }
    })();

    // Cleanup on unmount
    return () => {
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync();
      }
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
    };
  }, []);

  const startRecording = async () => {
    if (!hasPermission) {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('权限提示', '需要麦克风权限才能使用语音功能');
        return;
      }
      setHasPermission(true);
    }

    if (recordingRef.current) {
      await recordingRef.current.stopAndUnloadAsync();
      recordingRef.current = null;
    }

    try {
      await Audio.setAudioModeAsync({ 
        allowsRecordingIOS: true, 
        playsInSilentModeIOS: true 
      });
      
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      recordingRef.current = recording;
      setIsRecording(true);
    } catch (error) {
      console.error('录音失败:', error);
      Alert.alert('错误', '启动录音失败，请重试');
    }
  };

  const stopRecording = async () => {
    if (!recordingRef.current) return;

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      setIsRecording(false);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      if (uri) {
        await sendAudioToServer(uri);
      }
    } catch (error) {
      console.error('停止录音失败:', error);
      setIsRecording(false);
    }
  };

  const sendAudioToServer = async (uri: string) => {
    setIsProcessing(true);

    try {
      // Create form data
      const formData = new FormData();
      const response = await fetch(uri);
      const blob = await response.blob();
      formData.append('audio', blob, 'recording.m4a');

      // Send to server (without manual Content-Type header)
      const result = await fetch(`${API_BASE_URL}/api/v1/voice-chat`, {
        method: 'POST',
        body: formData,
      });

      const data = await result.json();

      if (data.success) {
        // Check if reminder was set
        const hasReminder = /提醒|记住了/i.test(data.aiResponse);
        
        // Schedule local notification if reminder was set
        if (hasReminder && data.memo) {
          try {
            const { status } = await Notifications.getPermissionsAsync();
            if (status === 'granted') {
              // Get reminder time from response
              const reminderTime = data.memo.reminder_time;
              if (reminderTime) {
                const rt = new Date(reminderTime);
                if (rt > new Date()) {
                  await Notifications.scheduleNotificationAsync({
                    content: {
                      title: '小秘提醒',
                      body: data.memo.content,
                      sound: true,
                    },
                    trigger: {
                      type: Notifications.SchedulableTriggerInputTypes.DATE,
                      date: rt,
                    },
                  });
                }
              }
            }
          } catch (notifError) {
            console.error('设置通知失败:', notifError);
          }
        }

        // Add user message
        const userMsg: Message = {
          id: Date.now().toString(),
          role: 'user',
          text: data.recognizedText || '（语音消息）',
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, userMsg]);

        // Add assistant message
        const assistantMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          text: data.aiResponse,
          audioUri: data.audioUri,
          timestamp: new Date(),
          hasReminder,
        };
        setMessages(prev => [...prev, assistantMsg]);

        // Auto play response
        if (data.audioUri) {
          await playAudio(data.audioUri, assistantMsg.id);
        }
      } else {
        Alert.alert('处理失败', data.error || '服务器处理失败');
      }
    } catch (error) {
      console.error('发送音频失败:', error);
      Alert.alert('错误', '网络请求失败，请检查网络连接');
    } finally {
      setIsProcessing(false);
    }
  };

  const playAudio = async (audioUri: string, messageId: string) => {
    try {
      // Stop current playback
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }

      setIsPlaying(true);
      setPlayingId(messageId);

      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUri },
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded && status.didJustFinish) {
            setIsPlaying(false);
            setPlayingId(null);
          }
        }
      );
      soundRef.current = sound;
    } catch (error) {
      console.error('播放失败:', error);
      setIsPlaying(false);
      setPlayingId(null);
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('zh-CN', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <Screen safeAreaEdges={['top', 'left', 'right', 'bottom']}>
      <View className="flex-1 bg-background">
        {/* Header */}
        <View 
          className="px-6 py-4"
          style={{ paddingTop: insets.top + 12 }}
        >
          <Text className="text-2xl font-bold text-foreground">贴身秘书</Text>
          <Text className="text-sm text-muted mt-1">语音备忘，随时记录</Text>
        </View>

        {/* Messages */}
        <View className="flex-1 px-4">
          {messages.length === 0 ? (
            <View className="flex-1 items-center justify-center">
              <View className="w-20 h-20 rounded-full bg-accent/10 items-center justify-center mb-4">
                <Ionicons name="mic" size={40} color="#6366f1" />
              </View>
              <Text className="text-lg font-medium text-foreground">开始语音对话</Text>
              <Text className="text-sm text-muted mt-2 text-center px-8">
                点击下方按钮，告诉我需要记住的事情，{'\n'}或者询问我之前记住的内容
              </Text>
            </View>
          ) : (
            <View className="flex-1 py-4">
              {messages.map((msg) => (
                <View 
                  key={msg.id}
                  className={`mb-4 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <View 
                    className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                      msg.role === 'user' 
                        ? 'bg-accent rounded-br-md' 
                        : 'bg-surface rounded-bl-md'
                    }`}
                  >
                    <Text 
                      className={`text-base ${
                        msg.role === 'user' ? 'text-white' : 'text-foreground'
                      }`}
                    >
                      {msg.text}
                    </Text>
                    <View className="flex-row items-center justify-end mt-2 gap-2">
                      <Text className={`text-xs ${msg.role === 'user' ? 'text-white/70' : 'text-muted'}`}>
                        {formatTime(msg.timestamp)}
                      </Text>
                      {msg.role === 'assistant' && msg.audioUri && playingId === msg.id ? (
                      <TouchableOpacity
                        onPress={() => {
                          // Pause
                          setIsPlaying(false);
                          setPlayingId(null);
                        }}
                        className="p-1"
                      >
                        <Ionicons 
                          name="pause-circle" 
                          size={20} 
                          color="#6366f1" 
                        />
                      </TouchableOpacity>
                    ) : msg.role === 'assistant' && msg.audioUri ? (
                      <TouchableOpacity
                        onPress={() => playAudio(msg.audioUri!, msg.id)}
                        className="p-1"
                      >
                        <Ionicons 
                          name="play-circle" 
                          size={20} 
                          color="#6366f1" 
                        />
                      </TouchableOpacity>
                    ) : null}
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Recording Button */}
        <View 
          className="items-center pb-8"
          style={{ paddingBottom: insets.bottom + 24 }}
        >
          <TouchableOpacity
            onPress={isRecording ? stopRecording : startRecording}
            disabled={isProcessing}
            className={`w-20 h-20 rounded-full items-center justify-center ${
              isRecording 
                ? 'bg-red-500 shadow-lg shadow-red-500/50' 
                : 'bg-accent shadow-lg shadow-accent/50'
            }`}
            style={{
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 8,
            }}
          >
            {isProcessing ? (
              <ActivityIndicator color="white" size="large" />
            ) : isRecording ? (
              <View className="w-6 h-6 bg-white rounded-sm" />
            ) : (
              <Ionicons name="mic" size={32} color="white" />
            )}
          </TouchableOpacity>
          <Text className="text-sm text-muted mt-3">
            {isProcessing 
              ? '处理中...' 
              : isRecording 
                ? '点击停止' 
                : '长按录音'}
          </Text>
        </View>
      </View>
    </Screen>
  );
}
