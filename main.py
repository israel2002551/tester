from kivy.app import App
from kivy.utils import platform
from kivy.clock import Clock
from kivy.uix.label import Label

class WebWrapperApp(App):
    def build(self):
        # Update this with your hosted frontend URL
        self.target_url = "https://tester-mobile.vercel.app/" 
        
        # Fallback UI for Pydroid preview
        self.root = Label(text="Compiling needed for WebView...\nTarget: " + self.target_url)

        if platform == 'android':
            Clock.schedule_once(self.create_webview, 0)
            
        return self.root

    def create_webview(self, *args):
        from jnius import autoclass
        from android.runnable import run_on_ui_thread

        # Pulling Android Java classes into Python
        WebView = autoclass('android.webkit.WebView')
        WebViewClient = autoclass('android.webkit.WebViewClient')
        WebSettings = autoclass('android.webkit.WebSettings')
        Activity = autoclass('org.kivy.android.PythonActivity').mActivity

        @run_on_ui_thread
        def setup_ui():
            webview = WebView(Activity)
            webview.setWebViewClient(WebViewClient())
            
            settings = webview.getSettings()
            settings.setJavaScriptEnabled(True)
            settings.setDomStorageEnabled(True)
            
            # Optimization: Use cache if network is slow/absent
            settings.setCacheMode(WebSettings.LOAD_CACHE_ELSE_NETWORK)

            Activity.setContentView(webview)
            webview.loadUrl(self.target_url)

        setup_ui()

if __name__ == '__main__':
    WebWrapperApp().run()
          
