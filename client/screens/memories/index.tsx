import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, FlatList, Alert, RefreshControl, Modal, TextInput, ScrollView, Platform, KeyboardAvoidingView } from 'react-native';
import { Screen } from '@/components/Screen';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as Sharing from 'expo-sharing';

const API_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || 'https://witty-bikes-relax.loca.lt';

interface Memo {
  id: number;
  content: string;
  created_at: string;
  updated_at: string | null;
  reminder_time: string | null;
  file_path: string | null;
}

interface FileInfo {
  name: string;
  path: string;
  size: number;
  modified: string;
}

export default function MemoriesPage() {
  const insets = useSafeAreaInsets();
  const [memos, setMemos] = useState<Memo[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingMemo, setEditingMemo] = useState<Memo | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editReminder, setEditReminder] = useState('');
  const [showFiles, setShowFiles] = useState(false);
  const [files, setFiles] = useState<FileInfo[]>([]);

  const fetchMemos = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/memos`);
      const data = await response.json();
      if (data.success) {
        setMemos(data.data || []);
      }
    } catch (error) {
      console.error('获取记忆失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchFiles = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/memos/files`);
      const data = await response.json();
      if (data.success) {
        setFiles(data.data || []);
      }
    } catch (error) {
      console.error('获取文件失败:', error);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchMemos();
      fetchFiles();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchMemos();
    await fetchFiles();
    setRefreshing(false);
  };

  const requestNotificationPermission = async () => {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    return finalStatus === 'granted';
  };

  const scheduleReminder = async (memo: Memo, reminderTime: Date) => {
    const hasPermission = await requestNotificationPermission();
    if (!hasPermission) {
      Alert.alert('提示', '需要通知权限才能设置提醒');
      return false;
    }

    try {
      // Cancel existing reminders for this memo
      const existing = await Notifications.getPresentedNotificationsAsync();
      for (const n of existing) {
        if (n.request.content.data?.memoId === memo.id) {
          await Notifications.dismissNotificationAsync(n.request.identifier);
        }
      }

      // Schedule new reminder
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '小秘提醒',
          body: memo.content,
          data: { memoId: memo.id },
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: reminderTime,
        },
      });
      return true;
    } catch (error) {
      console.error('设置提醒失败:', error);
      return false;
    }
  };

  const openEditModal = (memo: Memo) => {
    setEditingMemo(memo);
    setEditContent(memo.content);
    setEditReminder(memo.reminder_time ? new Date(memo.reminder_time).toISOString().slice(0, 16) : '');
    setEditModalVisible(true);
  };

  const handleSaveEdit = async () => {
    if (!editingMemo || !editContent.trim()) {
      Alert.alert('错误', '内容不能为空');
      return;
    }

    let reminderTime: Date | null = null;
    if (editReminder) {
      reminderTime = new Date(editReminder);
      if (isNaN(reminderTime.getTime()) || reminderTime <= new Date()) {
        Alert.alert('错误', '提醒时间必须是未来时间');
        return;
      }
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/memos/${editingMemo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: editContent.trim(),
          reminder_time: reminderTime ? reminderTime.toISOString() : null,
        }),
      });
      const data = await response.json();

      if (data.success) {
        // Schedule notification if reminder is set
        if (reminderTime) {
          const scheduled = await scheduleReminder({ ...editingMemo, content: editContent.trim() }, reminderTime);
          if (scheduled) {
            Alert.alert('成功', '记忆已更新，提醒已设置');
          } else {
            Alert.alert('成功', '记忆已更新，但提醒权限不足');
          }
        } else {
          Alert.alert('成功', '记忆已更新');
        }
        
        setEditModalVisible(false);
        fetchMemos();
      } else {
        Alert.alert('错误', '更新失败');
      }
    } catch (error) {
      console.error('更新失败:', error);
      Alert.alert('错误', '网络请求失败');
    }
  };

  const deleteMemo = async (memo: Memo) => {
    Alert.alert(
      '删除记忆',
      '确定要删除这条记忆吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              const response = await fetch(`${API_BASE_URL}/api/v1/memos/${memo.id}`, {
                method: 'DELETE',
              });
              const data = await response.json();
              if (data.success) {
                setMemos(prev => prev.filter(m => m.id !== memo.id));
              } else {
                Alert.alert('错误', '删除失败');
              }
            } catch (error) {
              console.error('删除失败:', error);
              Alert.alert('错误', '网络请求失败');
            }
          },
        },
      ]
    );
  };

  const exportFile = async (file: FileInfo) => {
    try {
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('提示', '当前设备不支持分享');
        return;
      }

      await Sharing.shareAsync(file.path, {
        mimeType: 'application/json',
        dialogTitle: '分享记忆文件',
      });
    } catch (error) {
      console.error('导出失败:', error);
      Alert.alert('错误', '导出失败');
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return '昨天 ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } else if (days < 7) {
      return `${days}天前`;
    } else {
      return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
  };

  const formatReminder = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const renderMemoItem = ({ item }: { item: Memo }) => (
    <TouchableOpacity 
      className="bg-surface rounded-2xl p-4 mb-3 shadow-sm"
      onLongPress={() => openEditModal(item)}
      delayLongPress={500}
    >
      <Text className="text-base text-foreground leading-relaxed">{item.content}</Text>
      
      {item.reminder_time && (
        <View className="flex-row items-center mt-2 bg-amber-50 rounded-lg px-2 py-1 self-start">
          <Ionicons name="alarm-outline" size={14} color="#f59e0b" />
          <Text className="text-xs text-amber-600 ml-1">{formatReminder(item.reminder_time)}</Text>
        </View>
      )}
      
      <View className="flex-row items-center justify-between mt-3">
        <View className="flex-row items-center gap-1">
          <Ionicons name="time-outline" size={14} color="#9ca3af" />
          <Text className="text-xs text-muted">{formatDate(item.created_at)}</Text>
        </View>
        <View className="flex-row items-center gap-2">
          <TouchableOpacity
            onPress={() => openEditModal(item)}
            className="p-2 -m-2"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="pencil-outline" size={18} color="#6366f1" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => deleteMemo(item)}
            className="p-2 -m-2"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="trash-outline" size={18} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderFileItem = ({ item }: { item: FileInfo }) => {
    const date = new Date(item.modified).toLocaleDateString('zh-CN');
    return (
      <TouchableOpacity 
        className="bg-surface rounded-xl p-4 mb-2 flex-row items-center"
        onPress={() => exportFile(item)}
      >
        <View className="w-10 h-10 rounded-lg bg-blue-100 items-center justify-center">
          <Ionicons name="document-text" size={20} color="#3b82f6" />
        </View>
        <View className="flex-1 ml-3">
          <Text className="text-sm text-foreground font-medium">{item.name}</Text>
          <Text className="text-xs text-muted mt-1">{date}</Text>
        </View>
        <TouchableOpacity
          onPress={() => exportFile(item)}
          className="p-2"
        >
          <Ionicons name="share-outline" size={20} color="#6366f1" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const renderEmpty = () => (
    <View className="flex-1 items-center justify-center py-20">
      <View className="w-20 h-20 rounded-full bg-surface items-center justify-center mb-4">
        <Ionicons name="document-text-outline" size={40} color="#9ca3af" />
      </View>
      <Text className="text-lg font-medium text-foreground">暂无记忆</Text>
      <Text className="text-sm text-muted mt-2 text-center px-8">
        告诉小秘需要记住的事情，{'\n'}它会帮你保存下来
      </Text>
    </View>
  );

  return (
    <Screen safeAreaEdges={['top', 'left', 'right', 'bottom']}>
      <View className="flex-1 bg-background">
        {/* Header */}
        <View 
          className="px-6 py-4"
          style={{ paddingTop: insets.top + 12 }}
        >
          <Text className="text-2xl font-bold text-foreground">记忆库</Text>
          <View className="flex-row items-center justify-between mt-2">
            <Text className="text-sm text-muted">
              共 {memos.length} 条记忆
            </Text>
            <TouchableOpacity
              onPress={() => setShowFiles(!showFiles)}
              className="flex-row items-center"
            >
              <Ionicons name="folder-outline" size={16} color="#6366f1" />
              <Text className="text-sm text-accent ml-1">本地文件</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Local Files Section */}
        {showFiles && files.length > 0 && (
          <View className="px-4 mb-4">
            <Text className="text-sm text-muted mb-2">本地备份文件（可分享导出）</Text>
            {files.map((file, index) => (
              <View key={file.path}>
                {renderFileItem({ item: file })}
              </View>
            ))}
            <Text className="text-xs text-muted mt-1">
              点击文件可分享导出到其他应用
            </Text>
          </View>
        )}

        {/* Memo List */}
        {loading ? (
          <View className="flex-1 items-center justify-center">
            <Text className="text-muted">加载中...</Text>
          </View>
        ) : (
          <FlatList
            data={memos}
            renderItem={renderMemoItem}
            keyExtractor={(item) => item.id.toString()}
            contentContainerClassName="px-4 py-2 flex-grow-1"
            ListEmptyComponent={renderEmpty}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor="#6366f1"
              />
            }
            showsVerticalScrollIndicator={false}
          />
        )}

        {/* Edit Modal */}
        <Modal
          visible={editModalVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setEditModalVisible(false)}
        >
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <TouchableOpacity 
              className="flex-1 bg-black/50"
              activeOpacity={1}
              onPress={() => setEditModalVisible(false)}
            >
              <View className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl p-6">
                <View className="w-12 h-1 bg-gray-300 rounded-full self-center mb-4" />
                
                <Text className="text-lg font-bold text-foreground mb-4">编辑记忆</Text>
                
                <ScrollView className="max-h-40">
                  <TextInput
                    className="bg-gray-100 rounded-xl p-4 text-foreground text-base"
                    value={editContent}
                    onChangeText={setEditContent}
                    placeholder="记忆内容..."
                    placeholderTextColor="#9ca3af"
                    multiline
                    textAlignVertical="top"
                  />
                </ScrollView>

                <Text className="text-sm text-muted mt-4 mb-2">提醒时间（可选）</Text>
                <TextInput
                  className="bg-gray-100 rounded-xl px-4 py-3 text-foreground"
                  value={editReminder}
                  onChangeText={setEditReminder}
                  placeholder="格式: 2025-01-15T14:30"
                  placeholderTextColor="#9ca3af"
                />
                <Text className="text-xs text-muted mt-1">
                  格式示例: 2025-01-15T14:30 表示 2025年1月15日 14:30
                </Text>

                <View className="flex-row mt-6 gap-3">
                  <TouchableOpacity
                    onPress={() => setEditModalVisible(false)}
                    className="flex-1 py-3 rounded-xl bg-gray-100"
                  >
                    <Text className="text-center text-muted font-medium">取消</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleSaveEdit}
                    className="flex-1 py-3 rounded-xl bg-accent"
                  >
                    <Text className="text-center text-white font-medium">保存</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    </Screen>
  );
}
