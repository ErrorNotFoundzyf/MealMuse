import { usePreventRemove } from 'expo-router';
import { Alert } from 'react-native';

export function useUnsaved(dirty: boolean, discard: () => void) {
  usePreventRemove(dirty, ({ repeat }) => {
    Alert.alert('内容尚未保存', '离开会丢弃本次编辑，确定离开吗？', [
      { text: '继续编辑', style: 'cancel' },
      { text: '放弃修改', style: 'destructive', onPress: () => { discard(); repeat(); } },
    ]);
  });
}
