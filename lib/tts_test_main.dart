import 'package:flutter/material.dart';
import 'tts_test_page.dart';

void main() {
  runApp(const TtsTestApp());
}

class TtsTestApp extends StatelessWidget {
  const TtsTestApp({super.key});

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
      debugShowCheckedModeBanner: false,
      home: TtsTestPage(),
    );
  }
}