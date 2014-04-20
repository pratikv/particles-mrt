define([
  "utils",
  "Stats",
  "glMatrix"
  ],
  function(
    Utils
  ) {

  var gl = null;
  var ext = null;

  var modelMat = mat4.create();
  mat4.identity(modelMat);

  var Graphics = {
    CAM_FOV: 45,
    CAM_NEAR: 1,
    CAM_FAR: 1000,

    canvas: null,
    width: -1,
    height: -1,

    timer: 0.0,

    shaders: {
      particle: {
        vsFileName: "shaders/particle.vs",
        fsFileName: "shaders/particle.fs",
        attributes: {
          aPosition: {},
          aColor: {},
          aUV: {},
        },
        uniforms: {
          uModelMat: { value: null },
          uViewMat: { value: null },
          uProjectionMat: { value: null },
          uTexture0: { value: null },
        }
      },
      particleCompute: {
        vsFileName: "shaders/particleCompute.vs",
        fsFileName: "shaders/particleCompute.fs",
        attributes: {
          aPosition: {}
        },
        uniforms: {
          uResolution: { value: vec2.create() },
          uTime: { value: 0.0 },
          uDeltaT: { value: 0.0 },
          uTexture0: { value: null },
          uTexture1: { value: null },
          uTexture2: { value: null },
        }
      }
    },

    vertexBuffers: {
      particlePos: {
        size: 3,
        count: 3,
        data: new Float32Array([
          0.0,  1.0,  0.0,
         -1.0, -1.0,  0.0,
          1.0, -1.0,  0.0
        ])
      },
      particleCol: {
        size: 4,
        count: 3,
        data: new Float32Array([
          1.0, 1.0, 1.0, 1.0,
          1.0, 1.0, 1.0, 1.0,
          1.0, 1.0, 1.0, 0.0
        ])
      },
      particleUV: {
        size: 2,
        count: 3,
        data: new Float32Array([
          1.0, 0.0,
          0.0, 1.0,
          0.0, 0.0,
        ])
      },
      fullScreenQuadPos: {
        size: 3,
        count: 6,
        data: new Float32Array([
         -1.0, -1.0,  0.0,
          1.0,  1.0,  0.0,
         -1.0,  1.0,  0.0,
         -1.0, -1.0,  0.0,
          1.0, -1.0,  0.0,
          1.0,  1.0,  0.0,
        ])
      }
    },

    projectionMat: mat4.create(),
    viewMat: mat4.create(),

    particleComputeBuffer: {
      width: 256,
      height: 256,
      textures: new Array(3)
    },

    init: function(canvas) {
      this.canvas = canvas;
      this.onWindowResize();

      // init stats
      this.stats = new Stats();
      this.stats.domElement.style.position = 'absolute';
      this.stats.domElement.style.top = '0px';
      this.stats.domElement.style.zIndex = 100;
      document.body.appendChild( this.stats.domElement );

      this.clock = new Clock();

      (function(self) {
        window.addEventListener(
          'resize', function() {self.onWindowResize();}, false
        );
      })(this);

      this.generateParticleVertexData();

      this.initGL();
      this.initShaders();
      this.initBuffers();
      this.testTexture = this.loadTexture("images/test-spectrum.png",
        gl.LINEAR, gl.NEAREST,
        gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE,
        false);
      this.initFrameBuffer();

      // hardcode fixed bind texture for particle display
      gl.useProgram(this.shaders.particle.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.particleComputeBuffer.textures[0]);
      gl.uniform1i(this.shaders.particle.uniforms.uTexture0.location, 0);

      // fixed bind textures for particle compute
      gl.useProgram(this.shaders.particleCompute.program);
      gl.uniform1i(this.shaders.particleCompute.uniforms.uTexture0.location, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.particleComputeBuffer.textures[1]);
      gl.uniform1i(this.shaders.particleCompute.uniforms.uTexture1.location, 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.particleComputeBuffer.textures[2]);
      gl.uniform1i(this.shaders.particleCompute.uniforms.uTexture2.location, 2);
      gl.useProgram(null);
    },

    update: function(deltaT) {
      this.timer += deltaT;

      this.stats.update();

      this.logicUpdate(deltaT);
      this.drawToFrameBuffer();
      this.draw();
    },

    onWindowResize: function() {
      this.width = this.canvas.offsetWidth;
      this.height = this.canvas.offsetHeight;
      this.canvas.width = this.width;
      this.canvas.height = this.height;
    },

    initGL: function() {
      try {
        gl = this.canvas.getContext("webgl");
      } catch (e) {
      }
      if (!gl) {
        console.error("Your browser does not support WebGL.");
        return false;
      }

      // try {
      //   ext = gl.getExtension('WEBGL_draw_buffers');
      // } catch(e) {
      // }
      // if (!ext) {
      //   console.error("WEBGL_draw_buffers extension not supported");
      //   return false;
      // }

      gl.clearColor(0.0, 0.0, 0.0, 0.0);
      //gl.enable(gl.POINT_SMOOTH);

      var blend = true;
      if (blend) {
        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      }
      else {
        gl.enable(gl.DEPTH_TEST);
      }
    },

    compileShader: function(shader) {

      // compile vertex shader
      var vsScript = Utils.loadTextFile(shader.vsFileName);
      shader.vsShader = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(shader.vsShader, vsScript);
      gl.compileShader(shader.vsShader);
      if (!gl.getShaderParameter(shader.vsShader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader.vsShader));
        return false;
      }

      // compile fragment shader
      var fsScript = Utils.loadTextFile(shader.fsFileName);
      shader.fsShader = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(shader.fsShader, fsScript);
      gl.compileShader(shader.fsShader);
      if (!gl.getShaderParameter(shader.fsShader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader.fsShader));
        return false;
      }

      // link shaders
      shader.program = gl.createProgram();
      gl.attachShader(shader.program, shader.vsShader);
      gl.attachShader(shader.program, shader.fsShader);
      gl.linkProgram(shader.program);

      if (!gl.getProgramParameter(shader.program, gl.LINK_STATUS)) {
        console.error("Cannot link shaders");
        return false;
      }

      // get attribute and uniform locations
      for (var attributeName in shader.attributes) {
        shader.attributes[attributeName].location = gl.getAttribLocation(shader.program, attributeName);
      }
      for (var uniformName in shader.uniforms) {
        shader.uniforms[uniformName].location = gl.getUniformLocation(shader.program, uniformName);
      }

    },

    initShaders: function() {
      for (var shaderName in this.shaders) {
        this.compileShader(this.shaders[shaderName]);
        console.log("compiled shader "+shaderName);
        console.log(this.shaders[shaderName]);
      }
    },

    prepareVertexBuffer: function(vb) {
      vb.buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vb.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, vb.data, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    },

    initBuffers: function() {
      for (var vbName in this.vertexBuffers) {
        this.prepareVertexBuffer(this.vertexBuffers[vbName]);
      }
    },

    loadTexture: function(fileName, nearFilter, farFilter, wrapS, wrapT, generateMipmap) {
      var texture = {};
      texture.texture = gl.createTexture();
      texture.image = new Image();
      texture.image.onload = function() {
        gl.bindTexture(gl.TEXTURE_2D, texture.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texture.image);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearFilter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, farFilter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
        if (generateMipmap)
          gl.generateMipmap(gl.TEXTURE_2D);
        gl.bindTexture(gl.TEXTURE_2D, null);
        console.log("loaded texture "+fileName);
        console.log(texture);
      };
      texture.image.src = fileName;

      return texture;
    },

    initFrameBuffer: function() {
      // NOTE: no depth, not generating renderbuffer for depth

      // init textures
      for (var i=0; i<this.particleComputeBuffer.textures.length; ++i) {
        this.particleComputeBuffer.textures[i] = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.particleComputeBuffer.textures[i]);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA,
          this.particleComputeBuffer.width, this.particleComputeBuffer.height,
          0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }

      if (this.ext) {
        // init frame buffer
        this.particleComputeBuffer.frameBuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.particleComputeBuffer.frameBuffer);

        // hardcoded bind 3 textures
        gl.framebufferTexture2D(gl.FRAMEBUFFER, ext.COLOR_ATTACHMENT0_WEBGL, gl.TEXTURE_2D, this.particleComputeBuffer.textures[0], 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, ext.COLOR_ATTACHMENT1_WEBGL, gl.TEXTURE_2D, this.particleComputeBuffer.textures[1], 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, ext.COLOR_ATTACHMENT2_WEBGL, gl.TEXTURE_2D, this.particleComputeBuffer.textures[2], 0);

        ext.drawBuffersWEBGL([
          ext.COLOR_ATTACHMENT0_WEBGL, // gl_FragData[0]
          ext.COLOR_ATTACHMENT1_WEBGL, // gl_FragData[1]
          ext.COLOR_ATTACHMENT2_WEBGL, // gl_FragData[2]
        ]);
      }
      else {
        // init frame buffer
        this.particleComputeBuffer.frameBuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.particleComputeBuffer.frameBuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.particleComputeBuffer.textures[0], 0);
      }

      if (!gl.isFramebuffer(this.particleComputeBuffer.frameBuffer)) {
        console.error("Frame buffer failed");
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      console.log("frame buffer initialized");
      console.log(this.particleComputeBuffer);

      // set resolution uniform
      this.shaders.particleCompute.uniforms.uResolution.value[0] = this.particleComputeBuffer.width;
      this.shaders.particleCompute.uniforms.uResolution.value[1] = this.particleComputeBuffer.height;

      gl.useProgram(this.shaders.particleCompute.program);
      gl.uniform2f(
        this.shaders.particleCompute.uniforms.uResolution.location,
        this.shaders.particleCompute.uniforms.uResolution.value[0],
        this.shaders.particleCompute.uniforms.uResolution.value[1]);
      gl.useProgram(null);
    },

    generateParticleVertexData: function() {
      this.vertexBuffers.particleUV.size = 2;
      this.vertexBuffers.particleUV.count = this.particleComputeBuffer.width * this.particleComputeBuffer.height;

      var uvArray = [];
      for (var y=0; y<this.particleComputeBuffer.height; ++y) {
        for (var x=0; x<this.particleComputeBuffer.width; ++x) {
          uvArray.push(x/this.particleComputeBuffer.width);
          uvArray.push(y/this.particleComputeBuffer.height);
        }
      }

      this.vertexBuffers.particleUV.data = new Float32Array(uvArray);
    },

    logicUpdate: function(deltaT) {
      // TODO: auto update shader uniforms from value, through function

      // perspective
      mat4.perspective(this.projectionMat, 45, this.width / this.height, 0.1, 100.0);

      // camera
      mat4.identity(this.viewMat);
      mat4.translate(this.viewMat, this.viewMat, [0.0, 0.0, -5.0]);

      // update uniforms for view/project matrix
      for (var shaderName in this.shaders) {
        var shader = this.shaders[shaderName];

        if (!shader.uniforms.uProjectionMat || !shader.uniforms.uViewMat)
          continue;

        shader.uniforms.uProjectionMat.value = this.projectionMat;
        shader.uniforms.uViewMat.value = this.viewMat;

        gl.useProgram(shader.program);
        gl.uniformMatrix4fv(shader.uniforms.uProjectionMat.location, false, shader.uniforms.uProjectionMat.value);
        gl.uniformMatrix4fv(shader.uniforms.uViewMat.location, false, shader.uniforms.uViewMat.value);
        gl.useProgram(null);
      }

      // test animate model matrix
      mat4.rotateY(modelMat, modelMat, 0.01);
      this.shaders.particle.uniforms.uModelMat.value = modelMat;
      gl.useProgram(this.shaders.particle.program);
      gl.uniformMatrix4fv(this.shaders.particle.uniforms.uModelMat.location, false, this.shaders.particle.uniforms.uModelMat.value);
      gl.useProgram(null);

      // update particleCompute shader uniforms
      this.shaders.particleCompute.uniforms.uTime.value = this.timer;
      this.shaders.particleCompute.uniforms.uDeltaT.value = deltaT;
      gl.useProgram(this.shaders.particleCompute.program);
      gl.uniform1f(this.shaders.particleCompute.uniforms.uTime.location, this.shaders.particleCompute.uniforms.uTime.value);
      gl.uniform1f(this.shaders.particleCompute.uniforms.uDeltaT.location, this.shaders.particleCompute.uniforms.uDeltaT.value);
      gl.useProgram(null);
    },

    drawToFrameBuffer: function() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.particleComputeBuffer.frameBuffer);

      gl.viewport(0, 0, this.particleComputeBuffer.width, this.particleComputeBuffer.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // make sure no DEPTH_TEST

      gl.useProgram(this.shaders.particleCompute.program);

      gl.enableVertexAttribArray(this.shaders.particleCompute.attributes.aPosition.location);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffers.fullScreenQuadPos.buffer);
      gl.vertexAttribPointer(
        this.shaders.particleCompute.attributes.aPosition.location,
        this.vertexBuffers.fullScreenQuadPos.size, gl.FLOAT, false, 0, 0);

      // // bind textures
      // gl.activeTexture(gl.TEXTURE1);
      // gl.bindTexture(gl.TEXTURE_2D, this.particleComputeBuffer.textures[0]);
      // gl.uniform1i(this.shaders.particleCompute.uniforms.uTexture0.location, 1);
      // gl.activeTexture(gl.TEXTURE2);
      // gl.bindTexture(gl.TEXTURE_2D, this.particleComputeBuffer.textures[1]);
      // gl.uniform1i(this.shaders.particleCompute.uniforms.uTexture1.location, 2);
      // gl.activeTexture(gl.TEXTURE3);
      // gl.bindTexture(gl.TEXTURE_2D, this.particleComputeBuffer.textures[2]);
      // gl.uniform1i(this.shaders.particleCompute.uniforms.uTexture2.location, 3);

      gl.drawArrays(gl.TRIANGLES, 0, this.vertexBuffers.fullScreenQuadPos.count);

      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.disableVertexAttribArray(this.shaders.particleCompute.attributes.aPosition.location);
      gl.useProgram(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    draw: function() {
      gl.viewport(0, 0, this.width, this.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      
      // use shader program
      gl.useProgram(this.shaders.particle.program);

      // enable vbos
      // gl.enableVertexAttribArray(this.shaders.particle.attributes.aPosition.location);
      // gl.enableVertexAttribArray(this.shaders.particle.attributes.aColor.location);
      gl.enableVertexAttribArray(this.shaders.particle.attributes.aUV.location);

      // bind vbos
      // gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffers.particlePos.buffer);
      // gl.vertexAttribPointer(
      //   this.shaders.particle.attributes.aPosition.location,
      //   this.vertexBuffers.particlePos.size, gl.FLOAT, false, 0, 0);

      // gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffers.particleCol.buffer);
      // gl.vertexAttribPointer(
      //   this.shaders.particle.attributes.aColor.location,
      //   this.vertexBuffers.particleCol.size, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffers.particleUV.buffer);
      gl.vertexAttribPointer(
        this.shaders.particle.attributes.aUV.location,
        this.vertexBuffers.particleUV.size, gl.FLOAT, false, 0, 0);

      // // bind texture
      // gl.activeTexture(gl.TEXTURE0);
      // gl.bindTexture(gl.TEXTURE_2D, this.particleComputeBuffer.textures[0]);
      // gl.uniform1i(this.shaders.particle.uniforms.uTexture0.location, 0);

      gl.drawArrays(gl.POINTS, 0, this.vertexBuffers.particleUV.count);

      // cleanup

      // gl.bindTexture(gl.TEXTURE_2D, null);
      // gl.activeTexture(gl.FALSE);

      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      // gl.disableVertexAttribArray(this.shaders.particle.attributes.aPosition.location);
      // gl.disableVertexAttribArray(this.shaders.particle.attributes.aColor.location);
      gl.disableVertexAttribArray(this.shaders.particle.attributes.aUV.location);

      gl.useProgram(null);
    }
  };

  return Graphics;
});