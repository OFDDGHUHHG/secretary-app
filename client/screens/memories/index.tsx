import { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, FlatList, Alert, RefreshControl } from 'react-native';
import { Screen } from '@/components/Screen';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';

const API_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || 'http://localhost:9091';

interface Memo {
  id: number;
  content: string;
  created_at: string;
  updated_at: string | null;
}

export default function MemoriesPage() {
  const insets = useSafeAreaInsets();
  const [memos, setMemos] = useState<Memo[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

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

  useFocusEffect(
    useCallback(() => {
      fetchMemos();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchMemos();
    setRefreshing(false);
  };

  const deleteMemo = async (id: number) => {
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
              const response = await fetch(`${API_BASE_URL}/api/v1/memos/${id}`, {
                method: 'DELETE',
              });
              const data = await response.json();
              if (data.success) {
                setMemos(prev => prev.filter(m => m.id !== id));
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

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return '昨天';
    } else if (days < 7) {
      return `${days}天前`;
    } else {
      return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    }
  };

  const renderItem = ({ item }: { item: Memo }) => (
    <View className="bg-surface rounded-2xl p-4 mb-3 shadow-sm">
      <Text className="text-base text-foreground leading-relaxed">{item.content}</Text>
      <View className="flex-row items-center justify-between mt-3">
        <View className="flex-row items-center gap-1">
          <Ionicons name="time-outline" size={14} color="#9ca3af" />
          <Text className="text-xs text-muted">{formatDate(item.created_at)}</Text>
        </View>
        <TouchableOpacity
          onPress={() => deleteMemo(item.id)}
          className="p-2 -m-2"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="trash-outline" size={18} color="#ef4444" />
        </TouchableOpacity>
      </View>
    </View>
  );

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
          <Text className="text-sm text-muted mt-1">
            共 {memos.length} 条记忆
          </Text>
        </View>

        {/* Memo List */}
        {loading ? (
          <View className="flex-1 items-center justify-center">
            <Text className="text-muted">加载中...</Text>
          </View>
        ) : (
          <FlatList
            data={memos}
            renderItem={renderItem}
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
      </View>
    </Screen>
  );
}
