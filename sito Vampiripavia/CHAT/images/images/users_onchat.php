<?	
	include ("./db_connect.php");
	

	$t = time();
	$tstamp = mktime(date("H",$t),date("i",$t),date("s",$t));
	
	$tstamp -= 35;
	
	$query_ora = mysql_query("DELETE FROM users WHERE data <".$tstamp );

	
	$query_ora = mysql_query("SELECT * FROM users WHERE obfuscate = 0");
	
	$onchat = array();
	
	while ($result = @mysql_fetch_array($query_ora)){
		array_push($onchat,$result['nome']);		
	}
	
	$tot = count($onchat);
	
	
	if ($tot == 1){
		echo "In <a href=\"javascript:apri('http://www.tremere.it/chat_login.php','750','570','yes')\" class=\"plain\"><b><i><u>Chat</u></i></b></a> c'è 1 cainita:<br>".$onchat[0]; 				
	}else{
		echo "In <a href=\"javascript:apri('http://www.tremere.it/chat_login.php','750','570','yes')\" class=\"plain\"><b><i><u>Chat</u></i></b></a> ci sono ".$tot." cainiti:<br>";
			while (count($onchat)>0){
				echo array_pop($onchat)."<br>";
			}
	}
	

	mysql_close();

?>