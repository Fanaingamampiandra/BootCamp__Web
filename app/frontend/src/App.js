import React, { useState, useEffect, createContext, useContext } from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import axios from "axios";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Badge } from "./components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { toast } from "sonner";
import { ShoppingCart, User, Search, Filter, Star, Plus, Minus, Trash2, LogOut } from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Auth Context
const AuthContext = createContext();

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));

  useEffect(() => {
    if (token) {
      fetchUser();
    }
  }, [token]);

  const fetchUser = async () => {
    try {
      const response = await axios.get(`${API}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUser(response.data);
    } catch (error) {
      console.error("Failed to fetch user:", error);
      logout();
    }
  };

  const login = async (email, password) => {
    try {
      const response = await axios.post(`${API}/auth/login`, { email, password });
      const { access_token } = response.data;
      setToken(access_token);
      localStorage.setItem('token', access_token);
      toast.success("Connexion réussie!");
      return true;
    } catch (error) {
      toast.error("Email ou mot de passe incorrect");
      return false;
    }
  };

  const register = async (email, password, full_name) => {
    try {
      await axios.post(`${API}/auth/register`, { email, password, full_name });
      toast.success("Inscription réussie! Vous pouvez maintenant vous connecter.");
      return true;
    } catch (error) {
      toast.error(error.response?.data?.detail || "Erreur lors de l'inscription");
      return false;
    }
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('token');
    toast.success("Déconnexion réussie");
  };

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// Cart Context
const CartContext = createContext();

const CartProvider = ({ children }) => {
  const [cartItems, setCartItems] = useState([]);
  const [cartCount, setCartCount] = useState(0);
  const { token } = useAuth();

  useEffect(() => {
    if (token) {
      fetchCart();
    } else {
      setCartItems([]);
      setCartCount(0);
    }
  }, [token]);

  const fetchCart = async () => {
    try {
      const response = await axios.get(`${API}/cart`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setCartItems(response.data);
      setCartCount(response.data.reduce((sum, item) => sum + item.quantity, 0));
    } catch (error) {
      console.error("Failed to fetch cart:", error);
    }
  };

  const addToCart = async (productId, size, quantity = 1) => {
    try {
      await axios.post(`${API}/cart/add`, 
        { product_id: productId, size, quantity },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      fetchCart();
      toast.success("Produit ajouté au panier!");
    } catch (error) {
      toast.error("Erreur lors de l'ajout au panier");
    }
  };

  const removeFromCart = async (itemId) => {
    try {
      await axios.delete(`${API}/cart/${itemId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchCart();
      toast.success("Produit retiré du panier");
    } catch (error) {
      toast.error("Erreur lors de la suppression");
    }
  };

  return (
    <CartContext.Provider value={{ cartItems, cartCount, addToCart, removeFromCart, fetchCart }}>
      {children}
    </CartContext.Provider>
  );
};

const useCart = () => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
};

// Header Component
const Header = () => {
  const { user, logout } = useAuth();
  const { cartCount } = useCart();
  const [showAuth, setShowAuth] = useState(false);
  const [showCart, setShowCart] = useState(false);

  return (
    <header className="border-b bg-white/95 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent">
            KickShop
          </h1>
        </div>

        <div className="flex items-center space-x-4">
          {user ? (
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">Bonjour, {user.full_name}</span>
              <CartButton onClick={() => setShowCart(true)} count={cartCount} />
              <Button variant="outline" size="sm" onClick={logout}>
                <LogOut className="h-4 w-4 mr-2" />
                Déconnexion
              </Button>
            </div>
          ) : (
            <Button onClick={() => setShowAuth(true)} data-testid="login-button">
              <User className="h-4 w-4 mr-2" />
              Se connecter
            </Button>
          )}
        </div>
      </div>

      <AuthModal open={showAuth} onClose={() => setShowAuth(false)} />
      <CartModal open={showCart} onClose={() => setShowCart(false)} />
    </header>
  );
};

// Cart Button Component
const CartButton = ({ onClick, count }) => (
  <Button variant="outline" size="sm" onClick={onClick} className="relative" data-testid="cart-button">
    <ShoppingCart className="h-4 w-4" />
    {count > 0 && (
      <Badge className="absolute -top-2 -right-2 h-5 w-5 rounded-full p-0 flex items-center justify-center bg-red-500">
        {count}
      </Badge>
    )}
  </Button>
);

// Auth Modal Component
const AuthModal = ({ open, onClose }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const { login, register } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (isLogin) {
      const success = await login(email, password);
      if (success) {
        onClose();
        setEmail("");
        setPassword("");
      }
    } else {
      const success = await register(email, password, fullName);
      if (success) {
        setIsLogin(true);
        setFullName("");
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent data-testid="auth-modal">
        <DialogHeader>
          <DialogTitle>{isLogin ? "Connexion" : "Inscription"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <Input
              type="text"
              placeholder="Nom complet"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              data-testid="fullname-input"
            />
          )}
          <Input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            data-testid="email-input"
          />
          <Input
            type="password"
            placeholder="Mot de passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            data-testid="password-input"
          />
          <Button type="submit" className="w-full" data-testid="auth-submit-button">
            {isLogin ? "Se connecter" : "S'inscrire"}
          </Button>
          <Button
            type="button"
            variant="link"
            onClick={() => setIsLogin(!isLogin)}
            className="w-full"
            data-testid="toggle-auth-mode"
          >
            {isLogin ? "Pas de compte ? S'inscrire" : "Déjà un compte ? Se connecter"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

// Cart Modal Component
const CartModal = ({ open, onClose }) => {
  const { cartItems, removeFromCart } = useCart();
  const [products, setProducts] = useState({});

  useEffect(() => {
    if (cartItems.length > 0) {
      fetchProductDetails();
    }
  }, [cartItems]);

  const fetchProductDetails = async () => {
    const productMap = {};
    for (const item of cartItems) {
      try {
        const response = await axios.get(`${API}/products/${item.product_id}`);
        productMap[item.product_id] = response.data;
      } catch (error) {
        console.error("Failed to fetch product:", error);
      }
    }
    setProducts(productMap);
  };

  const total = cartItems.reduce((sum, item) => {
    const product = products[item.product_id];
    return sum + (product ? product.price * item.quantity : 0);
  }, 0);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md" data-testid="cart-modal">
        <DialogHeader>
          <DialogTitle>Mon Panier ({cartItems.length})</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 max-h-96 overflow-y-auto">
          {cartItems.length === 0 ? (
            <p className="text-center text-gray-500" data-testid="empty-cart-message">Votre panier est vide</p>
          ) : (
            cartItems.map((item) => {
              const product = products[item.product_id];
              if (!product) return null;
              
              return (
                <div key={item.id} className="flex items-center space-x-3 border-b pb-3" data-testid={`cart-item-${item.id}`}>
                  <img
                    src={product.image_url}
                    alt={product.name}
                    className="w-16 h-16 object-cover rounded"
                  />
                  <div className="flex-1">
                    <h4 className="font-medium text-sm">{product.name}</h4>
                    <p className="text-sm text-gray-500">Taille: {item.size}</p>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{product.price}€</span>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm">Qté: {item.quantity}</span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => removeFromCart(item.id)}
                          data-testid={`remove-item-${item.id}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        {cartItems.length > 0 && (
          <div className="border-t pt-4">
            <div className="flex justify-between items-center mb-4">
              <span className="font-bold">Total: {total.toFixed(2)}€</span>
            </div>
            <Button className="w-full" data-testid="checkout-button">
              Procéder au paiement
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

// Product Card Component
const ProductCard = ({ product }) => {
  const { user } = useAuth();
  const { addToCart } = useCart();
  const [selectedSize, setSelectedSize] = useState("");
  const [showSizeDialog, setShowSizeDialog] = useState(false);

  const handleAddToCart = () => {
    if (!user) {
      toast.error("Veuillez vous connecter pour ajouter au panier");
      return;
    }
    setShowSizeDialog(true);
  };

  const confirmAddToCart = () => {
    if (selectedSize) {
      addToCart(product.id, parseFloat(selectedSize));
      setShowSizeDialog(false);
      setSelectedSize("");
    }
  };

  return (
    <>
      <Card className="group hover:shadow-xl transition-all duration-300 border-0 bg-white/80 backdrop-blur-sm" data-testid={`product-card-${product.id}`}>
        <CardContent className="p-0">
          <div className="relative overflow-hidden rounded-t-lg">
            <img
              src={product.image_url}
              alt={product.name}
              className="w-full h-64 object-cover group-hover:scale-105 transition-transform duration-300"
            />
            <Badge className="absolute top-3 left-3 bg-white/90 text-gray-800">
              {product.brand}
            </Badge>
          </div>
          <div className="p-6">
            <h3 className="font-bold text-lg mb-2 text-gray-800">{product.name}</h3>
            <p className="text-gray-600 text-sm mb-4 line-clamp-2">{product.description}</p>
            <div className="flex items-center justify-between mb-4">
              <span className="text-2xl font-bold text-orange-600">{product.price}€</span>
              <Badge variant="outline" className="text-xs">
                {product.category}
              </Badge>
            </div>
            <Button 
              className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white border-0" 
              onClick={handleAddToCart}
              data-testid={`add-to-cart-${product.id}`}
            >
              <Plus className="h-4 w-4 mr-2" />
              Ajouter au panier
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showSizeDialog} onOpenChange={setShowSizeDialog}>
        <DialogContent data-testid="size-selection-modal">
          <DialogHeader>
            <DialogTitle>Choisir la taille</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Select onValueChange={setSelectedSize}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionnez votre taille" />
              </SelectTrigger>
              <SelectContent>
                {product.sizes.map((size) => (
                  <SelectItem key={size} value={size.toString()} data-testid={`size-option-${size}`}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button 
              className="w-full" 
              onClick={confirmAddToCart} 
              disabled={!selectedSize}
              data-testid="confirm-add-to-cart"
            >
              Confirmer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

// Filter Component
const ProductFilters = ({ onCategoryChange, onBrandChange, onSearch, selectedCategory, selectedBrand }) => {
  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-lg p-6 mb-8 border" data-testid="product-filters">
      <div className="flex flex-col md:flex-row gap-4 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Rechercher des chaussures..."
            className="pl-10"
            onChange={(e) => onSearch(e.target.value)}
            data-testid="search-input"
          />
        </div>
        
        <Select value={selectedCategory} onValueChange={onCategoryChange}>
          <SelectTrigger className="w-full md:w-48" data-testid="category-filter">
            <SelectValue placeholder="Catégorie" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les catégories</SelectItem>
            <SelectItem value="sneakers">Sneakers</SelectItem>
            <SelectItem value="boots">Bottes</SelectItem>
            <SelectItem value="casual">Décontractées</SelectItem>
            <SelectItem value="athletic">Sport</SelectItem>
            <SelectItem value="formal">Formelles</SelectItem>
          </SelectContent>
        </Select>

        <Select value={selectedBrand} onValueChange={onBrandChange}>
          <SelectTrigger className="w-full md:w-48" data-testid="brand-filter">
            <SelectValue placeholder="Marque" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les marques</SelectItem>
            <SelectItem value="Nike">Nike</SelectItem>
            <SelectItem value="Adidas">Adidas</SelectItem>
            <SelectItem value="Puma">Puma</SelectItem>
            <SelectItem value="Converse">Converse</SelectItem>
            <SelectItem value="Vans">Vans</SelectItem>
            <SelectItem value="Timberland">Timberland</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

// Home Component
const Home = () => {
  const [products, setProducts] = useState([]);
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedBrand, setSelectedBrand] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    initializeProducts();
    fetchProducts();
  }, []);

  useEffect(() => {
    filterProducts();
  }, [products, selectedCategory, selectedBrand, searchTerm]);

  const initializeProducts = async () => {
    try {
      await axios.post(`${API}/init-products`);
    } catch (error) {
      console.error("Failed to initialize products:", error);
    }
  };

  const fetchProducts = async () => {
    try {
      const response = await axios.get(`${API}/products`);
      setProducts(response.data);
      setLoading(false);
    } catch (error) {
      console.error("Failed to fetch products:", error);
      setLoading(false);
    }
  };

  const filterProducts = () => {
    let filtered = products;

    if (selectedCategory !== "all") {
      filtered = filtered.filter(product => product.category === selectedCategory);
    }

    if (selectedBrand !== "all") {
      filtered = filtered.filter(product => product.brand === selectedBrand);
    }

    if (searchTerm) {
      filtered = filtered.filter(product => 
        product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.description.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    setFilteredProducts(filtered);
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-96">
        <div className="text-xl">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-red-50">
      <div className="container mx-auto px-4 py-8">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <h1 className="text-5xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-orange-600 via-red-600 to-pink-600 bg-clip-text text-transparent">
            Découvrez votre style
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
            La plus grande sélection de chaussures tendance pour tous les styles et toutes les occasions
          </p>
        </div>

        <ProductFilters
          onCategoryChange={setSelectedCategory}
          onBrandChange={setSelectedBrand}
          onSearch={setSearchTerm}
          selectedCategory={selectedCategory}
          selectedBrand={selectedBrand}
        />

        {/* Products Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8" data-testid="products-grid">
          {filteredProducts.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>

        {filteredProducts.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg" data-testid="no-products-message">Aucun produit trouvé</p>
          </div>
        )}
      </div>
    </div>
  );
};

// Main App Component
function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <div className="App">
          <BrowserRouter>
            <Header />
            <Routes>
              <Route path="/" element={<Home />} />
            </Routes>
          </BrowserRouter>
        </div>
      </CartProvider>
    </AuthProvider>
  );
}

export default App;