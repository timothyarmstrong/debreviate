(function() {

  // Note: This should be in multiple files, but to avoid a build step and to
  //       avoid requiring the bookmarklet to download multiple files, it's all
  //       together (broken into a few sections).

  /********
   * TRIE *
   ********/

  /**
   * A trie is an object which holds strings, and each string can have some data
   * associated with it. Strings are added in O(n) where n is the length of the
   * string. Lookups can also be perfomed in O(n), regardless of the number of
   * strings in the trie.
   * @constructor
   */
  function Trie() {
    /**
     * The root node in the trie.
     * @type {!TrieNode}
     */
    Trie.prototype.root = new TrieNode();
  }

  /**
   * Add a string to the trie, with some associated data.
   * @param {string} value The string to add to the trie.
   * @param {string} data Some data to associate with the string.
   */
  Trie.prototype.add = function(value, data) {
    var currentNode = this.root;
    for (var i = 0; i < value.length; i++) {
      var edge = value[i];
      if (!(edge in currentNode.edges)) {
        currentNode.edges[edge] = new TrieNode();
      }
      currentNode = currentNode.edges[edge];
      if (i == value.length - 1) {
        currentNode.data = data;
        currentNode.isLeaf = true;
      }
    }
  }

  /**
   * Remove everything from the trie, resetting to it's initial state.
   */
  Trie.prototype.clear = function() {
    this.root = new TrieNode();
  }

  /**
   * An individual node in the trie.
   * @constructor
   */
  function TrieNode() {
    /**
     * The set of edges outgoing from this node. Each edge represents a single
     * character pointing to the next node in the chain.
     * @type {Object<string, TrieNode>}
     */
    this.edges = {};

    /**
     * If true, this node represents the end of a full string in the trie.
     * @type {boolean}
     */
    this.isLeaf = false;

    /**
     * The data associated with a completed string, if this is a leaf node.
     * @type {string}
     */
    this.data = null;
  }

  /**
   * This is an object which can perform incremental (character-by-character)
   * lookups in a trie.
   * @param {Trie} trie
   * @constructor
   */
  function TrieTraverser(trie) {
    /**
     * The current position in the traversed trie.
     * @private {TrieNode}
     */
    this.cursor_ = trie.root;
  }

  /**
   * Incrementally traverse the trie by a single character. Returns an object
   * indicating if it was possible to traverse the trie, if the traversal lead
   * to a leaf node, and if it did, the associated data of that node.
   * @param {string} char
   * @return {{
   *     couldTraverse: boolean,
   *     isLeaf: ?boolean,
   *     data: ?string
   * }}
   */
  TrieTraverser.prototype.traverse = function(char) {
    if (!(char in this.cursor_.edges)) {
      return {couldTraverse: false}
    }

    this.cursor_ = this.cursor_.edges[char];

    return {
      couldTraverse: true,
      isLeaf: this.cursor_.isLeaf,
      data: this.cursor_.data
    };
  };

  /*********************
   * UTILITY FUNCTIONS *
   *********************/

  /**
   * Given the Google Spreadsheet ID, return the URL to use to fetch it.
   * @param {string} id
   */
  function getDataUrl(id) {
    return 'https://spreadsheets.google.com/feeds/cells/' + id +
        '/1/public/basic?alt=json';
  }

  /**
   * Reverse a string.
   * @param {string} str
   * @return {string}
   */
  function reverseString(str) {
    // Simple implementation, but could fail on multibyte characters.
    return str.split('').reverse().join('');
  }

  /**
   * Check if a character should be considered a "boundary" character, capable
   * of separating words from each other.
   * @param {string} char The character to test.
   * @return {boolean}
   */
  function isBoundaryCharacter(char) {
    // Boundary characters are anything that's not alphanumeric.
    return !/[a-z0-9]/i.test(char);
  }

  /**
   * Check if an element is an editable HTML element.
   * Note: contenteditable is currently not supported.
   * @param {Element} element
   * @return {boolean}
   */
  function isEditableElement(element) {
    // TODO: Handle contenteditable?
    return ['INPUT', 'TEXTAREA'].indexOf(element.tagName) != -1;
  }

  /***********
   * GLOBALS *
   ***********/

  /**
   * The default Google Spreadsheets ID to use if one is not provided.
   * Note: The document should be marked as "anyone with the link can view" and
   *       should be 'Published to the Web'.
   * @const {string}
   */
  var DEFAULT_ID = '1wByQxdc-OPu4lAw9lZbVb0LyIK4nNQZQOktzKLai9Bc';

  /**
   * The amount of time in milleseconds that the program should wait before
   * replacing an abbreviation with its debreviation.
   * @const {number}
   */
  var WAIT_TIME = 500;

  /**
   * Whether this is the first time the program has been run (the second time
   * the bookmarklet is run will simply update to the latest data in the
   * spreadsheet).
   * @type {boolean}
   */
  var firstRun = false;

  /**
   * The trie where all the abbreviated strings are kept (with their debreviated
   * forms).
   * @type {Trie}
   */
  var trie = new Trie();

  /**
   * Timeout ID for checking the input to see if what was just typed should be
   * debreviated.
   * @type {number}
   */
  var processTimeout = 0;

  /****************
   * MAIN PROGRAM *
   ****************/

  /**
   * Parse the response from the Google Spreadsheet API, converting it into
   * key-value pairs for the configuration.
   * @param {!Object} data The raw data from the Spreadsheet API.
   * @return {!Object<string, string>} The result in the format
   *     abbreviation: debreviation.
   */
  function parseData(data) {
    var numCells = data.feed.entry.length;
    // The first two cells contain the title. The number of cells must be even
    // to form key-value pairs.
    if (numCells < 4 || numCells % 2 != 0) {
      console.error(
          'Invalid configuration, please check spreadsheet for proper format.');
      return {};
    }
    var result = {};
    for (var i = 2; i < data.feed.entry.length; i += 2) {
      result[data.feed.entry[i].content['$t']] =
          data.feed.entry[i + 1].content['$t'];
    }
    return result;
  }

  /**
   * Callback for when the user adds input to a text box.
   * @param {!Event}
   */
  function onInput(event) {
    if (!isEditableElement(event.target)) {
      return;
    }

    // Clear any pending processing.
    if (processTimeout) {
      clearTimeout(processTimeout);
    }

    // Prepare to process the input.
    processTimeout = setTimeout(processInput, WAIT_TIME);
  }

  /**
   * This is the main replacement code. It looks at the current cursor position,
   * and then tries to traverse backwards and find a replacement. If it finds
   * one, then it replaces it and repositions the cursor after the replacement.
   */
  function processInput() {
    // For simplicity, assume that the relevant selected element hasn't changed.
    var element = document.activeElement;

    // Do nothing if there is no longer a focused editable element.
    if (!element || !isEditableElement(element)) {
      return;
    }

    var cursorPosition = element.selectionStart;

    var traverser = new TrieTraverser(trie);

    var offset = 0;
    while (true) {
      // Step backwards by one character.
      offset--;
      var nextCharPosition = cursorPosition + offset;
      if (nextCharPosition < 0) {
        break;
      }
      var char = element.value[nextCharPosition];

      var result = traverser.traverse(char.toLowerCase());
      if (!result.couldTraverse) {
        break;
      } else if (result.isLeaf) {
        // Check for word boundary.
        if (nextCharPosition == 0 ||
            isBoundaryCharacter(element.value[nextCharPosition - 1])) {
          // Form the replacement.
          var before = element.value.substr(0, nextCharPosition);
          var replacement = result.data;
          // The abbreviations are not case-sensitive, but if it was typed with
          // a capital letter first, then capitalize the replacement too.
          if (char != char.toLowerCase() && replacement.length > 0) {
            replacement = replacement[0].toUpperCase() + replacement.substr(1);
          }
          var after = element.value.substr(cursorPosition);

          element.value = before + replacement + after;
          element.selectionStart = element.selectionEnd =
              before.length + replacement.length;
        }
      } else {
        // We could traverse, but we're not at a leaf yet, so keep traversing.
        continue;
      }
    }
  }

  /**
   * Callback to handle the response from the Google Spreadsheet API, populating
   * the trie with the data.
   * @this {!XMLHttpRequest}
   */
  function handleDataResponse() {
    var data = parseData(JSON.parse(this.response));

    trie.clear();
    for (var key in data) {
      trie.add(reverseString(key).toLowerCase(), data[key]);
    }

    showSplash();
  }

  /**
   * Show a quick splash to indicate that everything loaded right.
   */
  function showSplash() {
    var splash = document.createElement('div');
    splash.style.display = 'block';
    splash.style.background = 'rgba(0, 0, 0, 0.8)';
    splash.style.position = 'fixed';
    splash.style.left = '50%';
    splash.style.top = '50%';
    splash.style.transform = 'translate(-50%, -50%)';
    splash.style.borderRadius = '10px';
    splash.style.color = 'white';
    splash.style.fontFamily = 'sans-serif';
    splash.style.fontSize = '20pt';
    splash.style.padding = '20px';
    splash.style.transition = 'opacity 0.5s';
    splash.style.opacity = 0;
    splash.textContent = 'Debreviator Loaded'

    document.body.appendChild(splash);

    // Start fade in.
    setTimeout(function() {
      splash.style.opacity = 1;
    }, 0);

    // Start fade out.
    setTimeout(function() {
      splash.style.opacity = 0;
    }, 2000);

    // Remove from document.
    setTimeout(function() {
      document.body.removeChild(splash);
    }, 2500);
  }

  /**
   * The main entry point for the script. Call this to run or update the
   * debreviation program.
   * @param {string} id The Google Spreadsheet ID to use as a data source.
   */
  function main(id) {
    id = id || DEFAULT_ID;

    var xhr = new XMLHttpRequest();
    xhr.open('GET', getDataUrl(id), true);
    xhr.onload = handleDataResponse;
    xhr.send();

    if (!firstRun) {
      document.addEventListener('input', onInput, false);
      firstRun = true;
    }
  }

  // Provide the update function externally too.
  window['__debreviate'] = {main: main};
})();
