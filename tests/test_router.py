"""Tests of the router's agent building blocks (stdlib only, no model needed).

Run: python3 -m unittest discover -s tests
"""
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path

_TMP = tempfile.mkdtemp(prefix="lueur-test-")
os.environ["LUEUR_DATA_DIR"] = _TMP
os.environ["LUEUR_EMBED"] = "0"  # keyword search only: no llama-server needed

_SPEC = importlib.util.spec_from_file_location(
    "lueur_router", Path(__file__).resolve().parent.parent / "scripts" / "model-router.py"
)
router = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(router)


class ToolTests(unittest.TestCase):
    def test_calculator(self):
        self.assertEqual(router.tool_calculator({"expression": "0,17*2350"}, {}), "0.17*2350 = 399.5")
        self.assertIn("= 4", router.tool_calculator({"expression": "sqrt(16)"}, {}))

    def test_calculator_rejects_code_and_huge_powers(self):
        for expr in ("__import__('os').system('id')", "9**9**9", "open('/etc/passwd')"):
            self.assertTrue(router.tool_calculator({"expression": expr}, {}).startswith("Erreur"), expr)

    def test_fetch_url_blocks_internal_addresses(self):
        for url in ("http://127.0.0.1:4040/api/tunnels", "http://localhost:8081/health",
                    "http://192.168.1.1/", "http://[::1]/", "file:///etc/passwd"):
            self.assertTrue(router.tool_fetch_url({"url": url}, {}).startswith("Erreur"), url)

    def test_html_to_text_drops_scripts_and_navigation(self):
        title, text = router.html_to_text(
            "<title>T</title><script>evil()</script><nav>menu</nav><h1>Bonjour</h1><p>A &amp; B</p>"
        )
        self.assertEqual(title, "T")
        self.assertIn("Bonjour", text)
        self.assertIn("A & B", text)
        self.assertNotIn("evil", text)
        self.assertNotIn("menu", text)

    def test_duckduckgo_parser(self):
        parser = router._DuckDuckGoParser()
        parser.feed(
            '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&rut=x">Ex <b>A</b></a>'
            '<a class="result__snippet" href="x">Un <b>extrait</b></a>'
        )
        self.assertEqual(parser.results[0]["url"], "https://example.com/a")
        self.assertEqual(parser.results[0]["title"], "Ex A")
        self.assertEqual(parser.results[0]["snippet"], "Un extrait")

    def test_merge_streamed_tool_call_deltas(self):
        acc = {}
        router._merge_tool_calls(acc, [{"index": 0, "id": "a", "function": {"name": "web_search", "arguments": '{"que'}}])
        router._merge_tool_calls(acc, [{"index": 0, "function": {"arguments": 'ry": "x"}'}}])
        self.assertEqual(acc[0]["function"]["name"], "web_search")
        self.assertEqual(json.loads(acc[0]["function"]["arguments"]), {"query": "x"})


class MemoryTests(unittest.TestCase):
    def setUp(self):
        router.memory_clear()

    def test_add_dedupes_same_fact(self):
        first = router.memory_add("L'utilisateur utilise un Honor Magic7 Pro")
        again = router.memory_add("l'utilisateur utilise un honor magic7 pro")
        self.assertEqual(first["status"], "added")
        self.assertEqual(again["status"], "exists")
        self.assertEqual(router.memory_count(), 1)

    def test_search_and_delete(self):
        target = router.memory_add("L'utilisateur utilise un Honor Magic7 Pro")
        for i in range(12):
            router.memory_add(f"Fait sans rapport numéro {i} xyz{i}")
        found = router.memory_search("mon Honor Magic7 est lent")
        self.assertTrue(found)
        self.assertIn("Honor", found[0]["text"])
        self.assertTrue(router.memory_delete(target["id"]))
        self.assertFalse(router.memory_delete(target["id"]))

    def test_small_memory_is_always_injected(self):
        router.memory_add("L'utilisateur s'appelle Amine")
        self.assertEqual(len(router.memory_search("sans aucun rapport")), 1)


class DocumentTests(unittest.TestCase):
    def test_chunks_stay_small(self):
        text = "\n\n".join(f"Paragraphe {i} " + "mot " * 80 for i in range(40))
        chunks = router.chunk_text(text)
        self.assertGreater(len(chunks), 5)
        self.assertTrue(all(len(c) <= router.CHUNK_CHARS + 10 for c in chunks))

    def test_index_and_search(self):
        doc_id = router.index_document("conv-doc", "rapport.pdf", "Intro.\n\n" + "remplissage " * 400
                                       + "\n\nLa batterie fait 5850 mAh.\n\n" + "fin " * 300)
        found = router.search_documents("capacité batterie mAh", [doc_id])
        self.assertIn("5850", found[0]["text"])


class ContextTests(unittest.TestCase):
    def setUp(self):
        router.memory_clear()
        self.calls = []

        def fake_complete(model_id, messages, max_tokens=400, temperature=0.2):
            self.calls.append(messages)
            return "- Point 0 : l'utilisateur veut planter des fraisiers."

        self._complete = router.complete
        router.complete = fake_complete

    def tearDown(self):
        router.complete = self._complete

    def _history(self, conv):
        hist = []
        for i in range(30):
            hist.append({"role": "user", "content": f"Question {i} " + "blabla " * 120})
            hist.append({"role": "assistant", "content": f"Réponse {i} " + "texte " * 120})
        hist.append({"role": "user", "content": [
            {"type": "text", "text": "Quel téléphone ?"},
            {"type": "text", "text": "Fichier « notes.txt » :\n" + "le téléphone est un Honor. " * 300},
        ]})
        return {"model": "local", "max_tokens": 1024, "_lueur_conversation_id": conv,
                "messages": [{"role": "system", "content": "Sois concis."}] + hist}

    def test_fits_budget_with_summary_and_documents(self):
        router.memory_add("L'utilisateur utilise un Honor Magic7 Pro")
        job = router.GenerationJob("j1", {"model": "local"})
        out = router.build_context(job, self._history("c1"), 700, True)
        total = sum(router.estimate_tokens(m["content"]) for m in out)
        self.assertLessEqual(total, router.CTX - 1024 - 700)
        self.assertEqual(out[0]["role"], "system")
        self.assertIn("Sois concis", out[0]["content"])
        self.assertIn("fraisiers", out[0]["content"])           # summary
        self.assertIn("Informations mémorisées", out[0]["content"])  # memory
        self.assertEqual(out[1]["role"], "user")
        self.assertIsInstance(out[-1]["content"], str)            # text-only lists are flattened
        self.assertIn("indexé", out[-1]["content"])
        self.assertLessEqual(len(self.calls), 3)                  # bounded summary cost

    def test_summary_is_cached(self):
        router.build_context(router.GenerationJob("j2", {"model": "local"}), self._history("c2"), 700, False)
        count = len(self.calls)
        router.build_context(router.GenerationJob("j3", {"model": "local"}), self._history("c2"), 700, False)
        self.assertEqual(len(self.calls), count)


class ForgedRequestTests(unittest.TestCase):
    """A generated page in the sandboxed preview must not be able to drive the router."""

    @classmethod
    def setUpClass(cls):
        import threading
        from http.server import ThreadingHTTPServer
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), router.RouterHandler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.port = cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def post(self, headers):
        import http.client
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("POST", "/lueur/memory/clear", body=b"{}", headers=headers)
        res = conn.getresponse()
        res.read()
        conn.close()
        return res.status

    def test_rejects_simple_content_types(self):
        router.memory_add("Souvenir à protéger")
        self.assertEqual(self.post({"Content-Type": "text/plain"}), 415)
        self.assertEqual(self.post({}), 415)
        self.assertEqual(router.memory_count(), 1)

    def test_rejects_opaque_origin(self):
        self.assertEqual(self.post({"Content-Type": "application/json", "Origin": "null"}), 403)

    def test_accepts_json(self):
        self.assertEqual(self.post({"Content-Type": "application/json"}), 200)


if __name__ == "__main__":
    unittest.main()
