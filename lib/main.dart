export 'main_mobile.dart'
    if (dart.library.js_interop) 'main_web.dart';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:image_picker/image_picker.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

//같은 와이파이, 서버 켜있어야함
const String kServerHost = '자기 ip 넣기';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
      systemNavigationBarColor: Colors.white,
      systemNavigationBarIconBrightness: Brightness.dark,
    ),
  );
  runApp(const AccessNavApp());
}

class AccessNavApp extends StatelessWidget {
  const AccessNavApp({super.key});

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
      title: 'AccessNav',
      debugShowCheckedModeBanner: false,
      home: AccessNavWebScreen(),
    );
  }
}

class AccessNavWebScreen extends StatefulWidget {
  const AccessNavWebScreen({super.key});

  @override
  State<AccessNavWebScreen> createState() => _AccessNavWebScreenState();
}

class _AccessNavWebScreenState extends State<AccessNavWebScreen> {
  late final WebViewController _controller;
  final GoogleSignIn _googleSignIn = GoogleSignIn.instance;
  final ImagePicker _imagePicker = ImagePicker();
  String? _initializedGoogleClientId;
  double _progress = 0;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.white)
      ..addJavaScriptChannel(
        'AccessNavGoogle',
        onMessageReceived: (message) =>
            _handleNativeGoogleLogin(message.message),
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onProgress: (progress) {
            if (mounted) setState(() => _progress = progress / 100);
          },
        ),
      );
    _prepareWebView();
  }

  Future<void> _handleNativeGoogleLogin(String rawMessage) async {
    try {
      final message = jsonDecode(rawMessage) as Map<String, dynamic>;
      final clientId = (message['clientId'] ?? '').toString().trim();
      if (clientId.isEmpty) {
        throw const FormatException('Google 웹 클라이언트 ID가 없습니다.');
      }

      if (_initializedGoogleClientId != clientId) {
        await _googleSignIn.initialize(serverClientId: clientId);
        _initializedGoogleClientId = clientId;
      }

      final account = await _googleSignIn.authenticate();
      final idToken = account.authentication.idToken;
      if (idToken == null || idToken.isEmpty) {
        throw const FormatException('Google 인증 토큰을 받지 못했습니다.');
      }

      final result = await _postJson(
        Uri.parse('http://$kServerHost/api/auth/google'),
        {
          'idToken': idToken,
          'mode': message['mode'] ?? 'login',
          'userType': 'Requester',
        },
      );

      if (result['ok'] != true) {
        throw FormatException(
          (result['error'] ?? 'Google 로그인에 실패했습니다.').toString(),
        );
      }

      await _controller.runJavaScript('''
        localStorage.setItem('accessnavToken', ${jsonEncode(result['token'])});
        localStorage.setItem('accessnavUser', ${jsonEncode(jsonEncode(result['user']))});
        window.location.href = 'index.html';
      ''');
    } on GoogleSignInException catch (error) {
      await _showGoogleError(
        error.code == GoogleSignInExceptionCode.canceled
            ? 'Google 로그인이 취소되었습니다.'
            : 'Google 로그인 설정을 확인해주세요. (${error.code.name})',
      );
    } catch (error) {
      await _showGoogleError(
        error.toString().replaceFirst('FormatException: ', ''),
      );
    }
  }

  Future<Map<String, dynamic>> _postJson(
    Uri uri,
    Map<String, dynamic> body,
  ) async {
    final client = HttpClient();
    try {
      final request = await client.postUrl(uri);
      request.headers.contentType = ContentType.json;
      request.write(jsonEncode(body));
      final response = await request.close();
      final text = await response.transform(utf8.decoder).join();
      return jsonDecode(text) as Map<String, dynamic>;
    } finally {
      client.close(force: true);
    }
  }

  Future<void> _showGoogleError(String message) {
    return _controller.runJavaScript(
      'setAuthMessage(${jsonEncode(message)}, true);',
    );
  }

  Future<void> _prepareWebView() async {
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }

    final locationAllowed =
        permission == LocationPermission.whileInUse ||
        permission == LocationPermission.always;

    final platformController = _controller.platform;
    if (platformController is AndroidWebViewController) {
      await platformController.setOnShowFileSelector(_selectImageForWebView);
      await platformController.setGeolocationEnabled(true);
      await platformController.setGeolocationPermissionsPromptCallbacks(
        onShowPrompt: (request) async => GeolocationPermissionsResponse(
          allow:
              locationAllowed &&
              (request.origin.startsWith('http://$kServerHost') ||
                  request.origin.startsWith('https://$kServerHost')),
          retain: true,
        ),
      );
    }

    final debugGpsQuery = kDebugMode ? '&debugGps=1' : '';
    await _controller.loadRequest(
      Uri.parse(
        'http://$kServerHost/index.html?app=1&v=20260908-gps-simulator$debugGpsQuery',
      ),
    );
  }

  Future<List<String>> _selectImageForWebView(
    FileSelectorParams params,
  ) async {
    if (!mounted) return <String>[];

    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      useSafeArea: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: const Icon(Icons.photo_camera_outlined),
                title: const Text('카메라로 촬영'),
                onTap: () => Navigator.pop(context, ImageSource.camera),
              ),
              ListTile(
                leading: const Icon(Icons.photo_library_outlined),
                title: const Text('앨범에서 선택'),
                onTap: () => Navigator.pop(context, ImageSource.gallery),
              ),
            ],
          ),
        ),
      ),
    );

    if (source == null) return <String>[];

    try {
      final image = await _imagePicker.pickImage(
        source: source,
        imageQuality: 85,
        maxWidth: 2048,
      );
      return image == null ? <String>[] : <String>[Uri.file(image.path).toString()];
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('사진을 가져오지 못했습니다. 권한을 확인해주세요.')),
        );
      }
      return <String>[];
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop) return;
        if (await _controller.canGoBack()) {
          await _controller.goBack();
        } else if (context.mounted) {
          SystemNavigator.pop();
        }
      },
      child: Scaffold(
        backgroundColor: Colors.white,
        body: SafeArea(
          bottom: false,
          child: Stack(
            children: [
              WebViewWidget(controller: _controller),
              if (_progress < 1)
                Align(
                  alignment: Alignment.topCenter,
                  child: LinearProgressIndicator(
                    value: _progress,
                    minHeight: 2,
                    color: const Color(0xff49d11a),
                    backgroundColor: Colors.transparent,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
