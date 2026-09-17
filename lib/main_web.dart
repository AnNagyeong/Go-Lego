import 'package:flutter/material.dart';
import 'package:web/web.dart' as web;

void main() => runApp(const AccessNavApp());

class AccessNavApp extends StatelessWidget {
  const AccessNavApp({super.key});

  @override
  Widget build(BuildContext context) => const MaterialApp(
    title: 'AccessNav Mobile Preview',
    debugShowCheckedModeBanner: false,
    home: MobilePreview(),
  );
}

class MobilePreview extends StatefulWidget {
  const MobilePreview({super.key});

  @override
  State<MobilePreview> createState() => _MobilePreviewState();
}

class _MobilePreviewState extends State<MobilePreview> {
  double _width = 390;
  int _revision = 0;
  static const _configuredUrl = String.fromEnvironment('ACCESSNAV_WEB_URL');

  String get _url => _configuredUrl.isNotEmpty
      ? _configuredUrl
      : Uri.base.replace(port: 3000, path: '/index.html', query: 'app=1', fragment: '').toString();

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xffe9edf2),
    appBar: AppBar(
      title: const Text('AccessNav 모바일 디자인'),
      actions: [
        DropdownButton<double>(
          value: _width,
          items: const [
            DropdownMenuItem(value: 375, child: Text('375 px')),
            DropdownMenuItem(value: 390, child: Text('390 px')),
            DropdownMenuItem(value: 430, child: Text('430 px')),
          ],
          onChanged: (value) => setState(() => _width = value!),
        ),
        IconButton(
          tooltip: '웹 파일 변경 후 새로고침',
          onPressed: () => setState(() => _revision++),
          icon: const Icon(Icons.refresh),
        ),
      ],
    ),
    body: Column(children: [
      Padding(
        padding: const EdgeInsets.all(8),
        child: Text('백엔드: $_url\n화면이 비어 있으면 web_backend에서 node server.js를 실행하세요.',
            textAlign: TextAlign.center),
      ),
      Expanded(child: Center(child: SizedBox(
        width: _width,
        height: double.infinity,
        child: HtmlElementView.fromTagName(
          key: ValueKey(_revision),
          tagName: 'iframe',
          onElementCreated: (element) {
            final frame = element as web.HTMLIFrameElement;
            frame
              ..src = _url
              ..title = 'AccessNav 모바일 웹 화면'
              ..allow = 'geolocation; camera; microphone; clipboard-write'
              ..style.border = '0'
              ..style.width = '100%'
              ..style.height = '100%';
          },
        ),
      ))),
    ]),
  );
}
