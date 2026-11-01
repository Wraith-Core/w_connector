/* w_connector — spectate STREAMER, the resource's hidden ui_page (nui/capture.html). Wraith's own
 * capture code from w_admin (web-dist/script/wraithSpectate.js), so the connector needs no other resource.
 *
 * Game-frame capture uses the canonical CitizenFX method (raw WebGL): a 1x1 placeholder texture and the
 * wrap-mode sequence on GL_TEXTURE_WRAP_T issued with texParameterf, which nui-core detours to bind the
 * game's backbuffer. Only FiveM's client publishes that backbuffer; on RedM the texture keeps its BLUE
 * placeholder, which the panel detects and explains.
 */
(function () {
    "use strict";

    var canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    canvas.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
    (document.getElementById("app") || document.body).appendChild(canvas);

    var gl = canvas.getContext("webgl", {
        antialias: false, depth: false, alpha: false, stencil: false,
        desynchronized: true, powerPreference: "high-performance",
    });
    if (!gl) { console.warn("[wraith spectate] no WebGL context"); return; }

    function compile(type, src) {
        var s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
    }

    var program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, [
        "attribute vec2 aPos;",
        "attribute vec2 aTex;",
        "varying vec2 vTex;",
        "void main() { vTex = aTex; gl_Position = vec4(aPos, 0.0, 1.0); }",
    ].join("\n")));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, [
        "precision mediump float;",
        "varying vec2 vTex;",
        "uniform sampler2D uTex;",
        "void main() { gl_FragColor = texture2D(uTex, vTex); }",
    ].join("\n")));
    gl.linkProgram(program);
    gl.useProgram(program);

    // Full-screen triangle strip. Texcoords are flipped vertically: the game texture arrives DX-oriented.
    var posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    var texBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), gl.STATIC_DRAW);
    var aTex = gl.getAttribLocation(program, "aTex");
    gl.enableVertexAttribArray(aTex);
    gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, 0, 0);

    // The game-view texture. BLUE placeholder on purpose (see the header note).
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 255, 255]));
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    // Magic hook sequence (must be texParameterf, and uninterrupted on WRAP_T).
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    // Reset.
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.uniform1i(gl.getUniformLocation(program, "uTex"), 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.viewport(0, 0, canvas.width, canvas.height);

    function draw() {
        requestAnimationFrame(draw);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.finish();
    }
    draw();

    // ── resource name (for the NUI callback URL) ─────────────────────────────
    var resourceNameCache = null;
    function resName() {
        if (resourceNameCache) return resourceNameCache;
        try {
            if (typeof GetParentResourceName === "function") resourceNameCache = GetParentResourceName();
        } catch (e) {}
        if (!resourceNameCache) {
            var host = (window.location && window.location.host) ? String(window.location.host) : "";
            if (host.indexOf("cfx-nui-") === 0) resourceNameCache = host.substring(8);
        }
        if (!resourceNameCache) resourceNameCache = "w_connector";
        return resourceNameCache;
    }

    function sendOut(sessionId, kind, data) {
        try {
            fetch("https://" + resName() + "/webrtcSignalOut", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId: sessionId, kind: kind, data: data }),
            }).catch(function () {});
        } catch (e) {}
    }

    // ── WebRTC session: stream the WebGL canvas straight to the viewer ───────
    var session = null;

    function teardown() {
        if (!session) return;
        var s = session;
        session = null;
        if (s.stream) { try { s.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); } catch (e) {} }
        if (s.pc) { try { s.pc.close(); } catch (e) {} }
    }

    function startSession(sessionId, iceServers) {
        teardown();
        var pc = new RTCPeerConnection({ iceServers: iceServers || [] });
        var s = { sessionId: sessionId, pc: pc, stream: null };
        session = s;

        var stream = canvas.captureStream(20);
        s.stream = stream;
        stream.getVideoTracks().forEach(function (t) { try { pc.addTrack(t, stream); } catch (e) {} });

        pc.onicecandidate = function (e) {
            if (session !== s) return;
            if (e && e.candidate) {
                var c = e.candidate;
                sendOut(sessionId, "ice", (c.toJSON ? c.toJSON() : c));
            }
        };

        pc.createOffer().then(function (offer) {
            return pc.setLocalDescription(offer).then(function () {
                if (session === s) sendOut(sessionId, "offer", offer.sdp);
            });
        }).catch(function () {});
    }

    function handleSignal(sessionId, kind, data) {
        if (!session || session.sessionId !== sessionId || !session.pc) return;
        var pc = session.pc;
        try {
            if (kind === "answer") pc.setRemoteDescription({ type: "answer", sdp: data }).catch(function () {});
            else if (kind === "ice") pc.addIceCandidate(data).catch(function () {});
            else if (kind === "bye") teardown();
        } catch (e) {}
    }

    window.addEventListener("message", function (ev) {
        var d = (ev && ev.data) || {};
        if (d.action === "webrtcStart") startSession(d.sessionId, d.iceServers);
        else if (d.action === "webrtcSignal") handleSignal(d.sessionId, d.kind, d.data);
        else if (d.action === "webrtcStop") teardown();
    });
})();
