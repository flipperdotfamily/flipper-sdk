Pod::Spec.new do |s|
  s.name             = 'FlipperWidget'
  s.version          = '0.1.0'
  s.summary          = 'The flipper.family coin-flip widget for iOS (UIKit and SwiftUI), wired to your app’s own wallet.'
  s.description      = <<-DESC
    A drop-in, white-label flip widget for flipper.family, the coin-flip protocol on Robinhood Chain.
    It shows the hosted embed in a WKWebView and routes the embed's wallet requests (transactions, chain switches)
    to a wallet your app supplies (Reown AppKit / WalletConnect, an embedded wallet SDK, ...) over a small,
    allowlisted bridge. The page never sees keys: your wallet shows its own confirmation for every request.
  DESC
  s.homepage         = 'https://flipper.family'
  s.license          = { :type => 'MIT', :file => 'LICENSE' }
  s.author           = { 'flipper.family' => 'dev@flipper.family' }
  # SwiftPM needs Package.swift at a repository root, so iOS releases are published from a mirror of packages/ios
  # (git subtree split). The podspec's paths are relative to that root, which is also this directory.
  s.source           = { :git => 'https://github.com/flipperdotfamily/FlipperWidget-iOS.git', :tag => s.version.to_s }
  s.documentation_url = 'https://flipper.family/docs'

  s.ios.deployment_target = '15.0'
  s.swift_versions   = ['5.9', '5.10', '6.0']
  s.source_files     = 'Sources/FlipperWidget/**/*.swift'
  s.frameworks       = 'WebKit', 'Combine', 'SwiftUI', 'UIKit'
end
