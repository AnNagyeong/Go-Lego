import 'dart:collection';
import 'package:flutter_tts/flutter_tts.dart';

class TtsService {
  final FlutterTts _flutterTts = FlutterTts();

  // 읽어야 할 문장을 순서대로 저장
  final Queue<String> _speechQueue = Queue<String>();

  bool _isSpeaking = false;

  Future<void> init() async {
    await _flutterTts.setLanguage('ko-KR');
    await _flutterTts.setSpeechRate(0.45);
    await _flutterTts.setVolume(1.0);
    await _flutterTts.setPitch(1.0);

    // 한 문장을 다 읽었을 때 실행
    _flutterTts.setCompletionHandler(() {
      _isSpeaking = false;
      _speakNext();
    });

    // TTS 오류가 발생해도 다음 문장으로 이동
    _flutterTts.setErrorHandler((message) {
      _isSpeaking = false;
      _speakNext();
    });
  }

  // 일반 TTS
  Future<void> speak(String text) async {
    if (text.trim().isEmpty) return;

    await _flutterTts.stop();
    _speechQueue.clear();

    _isSpeaking = true;
    await _flutterTts.speak(text);
  }

  // 자동 음성 안내용
  void addToQueue(String text) {
    if (text.trim().isEmpty) return;

    _speechQueue.add(text);

    if (!_isSpeaking) {
      _speakNext();
    }
  }

  Future<void> _speakNext() async {
    if (_speechQueue.isEmpty) {
      _isSpeaking = false;
      return;
    }

    final String nextText = _speechQueue.removeFirst();

    _isSpeaking = true;
    await _flutterTts.speak(nextText);
  }

  Future<void> stop() async {
    _speechQueue.clear();
    _isSpeaking = false;

    await _flutterTts.stop();
  }
}