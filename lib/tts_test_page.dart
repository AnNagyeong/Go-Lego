import 'package:flutter/material.dart';
import 'services/tts_service.dart';

class TtsTestPage extends StatefulWidget {
  const TtsTestPage({super.key});

  @override
  State<TtsTestPage> createState() => _TtsTestPageState();
}

class _TtsTestPageState extends State<TtsTestPage> {
  final TtsService _ttsService = TtsService();

  // 자동 음성 안내 ON/OFF
  bool _autoTtsEnabled = false;

  // 테스트용 챗봇 답변 목록
  final List<String> _messages = [];

  @override
  void initState() {
    super.initState();
    _ttsService.init();
  }

  @override
  void dispose() {
    _ttsService.stop();
    super.dispose();
  }

  // 실제 챗봇이 완성되면
  // 이 함수에 챗봇의 String 응답을 전달하면 됨
  void _receiveBotMessage(String message) {
    setState(() {
      _messages.add(message);
    });

    // 자동 음성 안내가 켜져 있으면 Queue에 추가
    if (_autoTtsEnabled) {
      _ttsService.addToQueue(message);
    }
  }

  // 가짜 챗봇 답변 3개를 연속으로 발생시켜 테스트
  void _testChatbot() {
    _receiveBotMessage(
      '가장 가까운 화장실을 찾았습니다.',
    );

    _receiveBotMessage(
      '학생회관 1층에 장애인 화장실이 있습니다.',
    );

    _receiveBotMessage(
      '엘리베이터는 정문 오른쪽에 있습니다.',
    );
  }

  // 채팅 내용 초기화
  void _clearMessages() {
    _ttsService.stop();

    setState(() {
      _messages.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Go-Lego TTS 테스트'),
        centerTitle: true,
      ),

      body: Column(
        children: [
          // ==============================
          // 자동 음성 안내 설정
          // ==============================

          SwitchListTile(
            title: const Text(
              '자동 음성 안내',
              style: TextStyle(
                fontWeight: FontWeight.bold,
              ),
            ),
            subtitle: Text(
              _autoTtsEnabled
                  ? '챗봇의 새 답변을 자동으로 읽습니다.'
                  : '필요한 답변의 음성 버튼을 눌러 들을 수 있습니다.',
            ),
            secondary: Icon(
              _autoTtsEnabled
                  ? Icons.volume_up
                  : Icons.volume_off,
            ),
            value: _autoTtsEnabled,
            onChanged: (bool value) {
              setState(() {
                _autoTtsEnabled = value;
              });

              // 자동 음성 안내를 끄면
              // 현재 음성과 대기 중인 Queue도 중지
              if (!value) {
                _ttsService.stop();
              }
            },
          ),

          const Divider(),

          // ==============================
          // 테스트 버튼
          // ==============================

          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Wrap(
              spacing: 10,
              runSpacing: 10,
              alignment: WrapAlignment.center,
              children: [
                ElevatedButton.icon(
                  onPressed: _testChatbot,
                  icon: const Icon(Icons.smart_toy),
                  label: const Text('테스트 챗봇 답변'),
                ),

                ElevatedButton.icon(
                  onPressed: () {
                    _ttsService.stop();
                  },
                  icon: const Icon(Icons.stop),
                  label: const Text('음성 중지'),
                ),

                OutlinedButton.icon(
                  onPressed: _clearMessages,
                  icon: const Icon(Icons.delete_outline),
                  label: const Text('채팅 초기화'),
                ),
              ],
            ),
          ),

          const Divider(),

          // ==============================
          // 챗봇 메시지 영역
          // ==============================

          Expanded(
            child: _messages.isEmpty
                ? const Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.chat_bubble_outline,
                          size: 60,
                        ),

                        SizedBox(height: 15),

                        Text(
                          '아직 챗봇 답변이 없습니다.',
                          style: TextStyle(
                            fontSize: 16,
                          ),
                        ),

                        SizedBox(height: 8),

                        Text(
                          '위의 테스트 챗봇 답변 버튼을 눌러보세요.',
                          style: TextStyle(
                            fontSize: 13,
                          ),
                        ),
                      ],
                    ),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _messages.length,
                    itemBuilder: (context, index) {
                      final String message = _messages[index];

                      return Align(
                        alignment: Alignment.centerLeft,
                        child: Container(
                          constraints: const BoxConstraints(
                            maxWidth: 500,
                          ),
                          margin: const EdgeInsets.only(
                            bottom: 12,
                          ),
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: Colors.grey.shade200,
                            borderRadius: BorderRadius.circular(16),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment:
                                CrossAxisAlignment.start,
                            children: [
                              const Icon(
                                Icons.smart_toy,
                                size: 22,
                              ),

                              const SizedBox(width: 10),

                              Flexible(
                                child: Text(
                                  message,
                                  style: const TextStyle(
                                    fontSize: 16,
                                  ),
                                ),
                              ),

                              const SizedBox(width: 8),

                              // 개별 답변 TTS
                              IconButton(
                                tooltip: '음성으로 듣기',
                                onPressed: () {
                                  _ttsService.speak(message);
                                },
                                icon: const Icon(
                                  Icons.volume_up,
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}