// Adds a dedicated scene-detail button that passes Stash's original file path
// directly to the PotPlayer task. It deliberately does not use the rendered
// Path-link URL, which can change or encode characters such as % and #.
(function () {
  "use strict";

  var PLUGIN_ID = "PotPlayerPlay";
  var TASK_NAME = "Play in PotPlayer";
  var BUTTON_ID = "potplayer-play-button";
  var BUTTON_LABEL = "팟";
  var injectionScheduled = false;

  function getSceneId() {
    var match = window.location.pathname.match(/^\/scenes\/([^/]+)\/?$/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function graphQLEndpoint() {
    // Scene pages do not always declare a <base> element. An absolute path
    // avoids resolving to /scenes/graphql on those pages.
    return new URL("/graphql", window.location.origin).toString();
  }

  async function callGraphQL(query, variables) {
    var response = await fetch(graphQLEndpoint(), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query, variables: variables }),
    });

    if (!response.ok) {
      throw new Error("Stash request failed (HTTP " + response.status + ")");
    }

    var result = await response.json();
    if (result.errors && result.errors.length) {
      throw new Error(result.errors[0].message || "Stash request failed");
    }

    return result.data;
  }

  async function getOriginalFilePath(sceneId) {
    var data = await callGraphQL(
      "query FindSceneFile($id: ID!) { findScene(id: $id) { files { path } } }",
      { id: sceneId }
    );
    var files = data && data.findScene && data.findScene.files;

    if (!files || !files.length || !files[0].path) {
      throw new Error("The selected scene has no original video file");
    }

    // Stash returns the primary scene file first.
    return files[0].path;
  }

  async function runPotPlayerTask(path) {
    var data = await callGraphQL(
      "mutation RunPotPlayer($path: String!) { " +
        "runPluginTask(plugin_id: \"" +
        PLUGIN_ID +
        "\", task_name: \"" +
        TASK_NAME +
        "\", args: [{ key: \"path\", value: { str: $path } }]) " +
        "}",
      { path: path }
    );

    if (!data || !data.runPluginTask) {
      throw new Error("PotPlayer task could not be started");
    }
  }

  function resetButton(button, label) {
    if (!document.contains(button)) {
      return;
    }
    button.disabled = false;
    button.textContent = label;
  }

  async function openInPotPlayer(button) {
    var sceneId = getSceneId();
    if (!sceneId) {
      return;
    }

    button.disabled = true;
    button.textContent = "팟플레이어 여는 중…";

    try {
      var path = await getOriginalFilePath(sceneId);
      await runPotPlayerTask(path);
      // Stash queues the backend task asynchronously, so acknowledge the
      // request without implying that playback has already started.
      button.textContent = "요청됨";
      window.setTimeout(function () {
        resetButton(button, BUTTON_LABEL);
      }, 1000);
    } catch (error) {
      console.error("PotPlayerPlay:", error);
      button.textContent = "실패";
      window.setTimeout(function () {
        resetButton(button, BUTTON_LABEL);
      }, 2500);
    }
  }

  function createButton() {
    var button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "btn btn-primary btn-sm";
    button.textContent = BUTTON_LABEL;
    button.title = "팟플레이어로 재생하기";
    button.setAttribute("aria-label", "팟플레이어로 재생하기");
    button.addEventListener("click", function () {
      void openInPotPlayer(button);
    });
    return button;
  }

  function addButtonToToolbar(button) {
    var operationMenu = document.querySelector(".scene-toolbar #operation-menu");
    var operationSlot = operationMenu
      ? operationMenu.closest(".scene-toolbar-group > span")
      : null;
    var wrapper = document.createElement("span");
    wrapper.className = "potplayer-play-toolbar-slot";
    wrapper.appendChild(button);

    // Place the button immediately before the Operations menu. This matches
    // the current Stash toolbar without relying on localized file-detail text.
    if (operationSlot) {
      operationSlot.insertAdjacentElement("beforebegin", wrapper);
      return true;
    }

    // Keep the feature usable on Stash versions with a different toolbar DOM.
    var toolbar = document.querySelector(".scene-toolbar");
    if (toolbar) {
      toolbar.appendChild(wrapper);
      return true;
    }

    return false;
  }

  function ensureButton() {
    if (!getSceneId()) {
      var staleButton = document.getElementById(BUTTON_ID);
      if (staleButton) {
        staleButton.remove();
      }
      return;
    }

    if (document.getElementById(BUTTON_ID)) {
      return;
    }

    addButtonToToolbar(createButton());
  }

  function scheduleButtonInjection() {
    if (injectionScheduled) {
      return;
    }

    injectionScheduled = true;
    window.setTimeout(function () {
      injectionScheduled = false;
      ensureButton();
    }, 50);
  }

  function install() {
    if (
      window.PluginApi &&
      window.PluginApi.Event &&
      typeof window.PluginApi.Event.addEventListener === "function"
    ) {
      window.PluginApi.Event.addEventListener("stash:location", scheduleButtonInjection);
    }

    window.addEventListener("popstate", scheduleButtonInjection);
    window.addEventListener("hashchange", scheduleButtonInjection);

    var observer = new MutationObserver(scheduleButtonInjection);
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleButtonInjection();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
